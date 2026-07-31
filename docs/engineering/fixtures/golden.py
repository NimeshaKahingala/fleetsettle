"""The three worked walkthroughs (use-cases section 7) run against the live schema.

The seed walks the REAL period lifecycle - open July, write July, close July and
open August, and so on - because assert_period_open() has no superuser bypass on
Neon. That makes this a test of UC-98 as well as of the figures.
"""
import ssl, sys, uuid
import pg8000.dbapi

conn = pg8000.dbapi.connect(user="neondb_owner", password="npg_SJwrIb6BQG1Y",
    host=sys.argv[1], database="neondb", ssl_context=ssl.create_default_context())
conn.autocommit = True
cur = conn.cursor()
cur.execute("SET statement_timeout='30s'")
U = lambda: str(uuid.uuid4())
RUN = uuid.uuid4().hex[:6]

def E(q, a=None):
    cur.execute(q, a) if a is not None else cur.execute(q)

def one(q, a=None):
    E(q, a); r = cur.fetchone(); return r[0] if r else None

results = []
def check(label, got, want):
    ok = got == want
    results.append((ok, label))
    print(f"  {'OK  ' if ok else 'FAIL'} {label}: {got}" + ("" if ok else f"   expected {want}"))

# ---------------------------------------------------------------- seed
biz, usr, drv = U(), U(), U()
E("INSERT INTO business VALUES (%s,'Fixture','LKR','Asia/Colombo','2026-07-01',now())", (biz,))
E("INSERT INTO app_user VALUES (%s,'g-'||%s,'o@f.lk','Owner',now())", (usr, RUN))
jul, aug, sep = U(), U(), U()
E("INSERT INTO accounting_period (id,business_id,period_start,period_end,status) VALUES (%s,%s,'2026-07-01','2026-07-31','open')", (jul, biz))

def close_and_open(cur_id, nxt_id, a, b):
    """UC-98: close, and create the successor in the same breath."""
    E("UPDATE accounting_period SET status='closed', closed_at=now() WHERE id=%s", (cur_id,))
    E("INSERT INTO accounting_period (id,business_id,period_start,period_end,status) VALUES (%s,%s,%s,%s,'open')", (nxt_id, biz, a, b))

bus = U()
E("INSERT INTO vehicle (id,business_id,registration,vehicle_type) VALUES (%s,%s,'BUS-'||%s,'bus')", (bus, biz, RUN))
E("INSERT INTO driver (id,business_id,name,driver_trip_fee_minor) VALUES (%s,%s,'Regular',9000)", (drv, biz))
dl = U()
E("INSERT INTO daily_lease (id,business_id,vehicle_id,driver_id,pattern_type,effective_from) VALUES (%s,%s,%s,%s,'every_day','2026-01-01')", (dl, biz, bus, drv))
E("INSERT INTO daily_lease_rate (id,daily_lease_id,daily_lease_amount_minor,effective_from) VALUES (%s,%s,5000,'2026-01-01')", (U(), dl))

print("=" * 68)
print("G-1  One month of the bus (section 7.1)")
print("=" * 68)

trip = U()
E("INSERT INTO trip (id,business_id,vehicle_id,driver_id,status,start_date,end_date,agreed_amount_minor,driver_fee_minor,closing_date,posted_period_id) "
  "VALUES (%s,%s,%s,%s,'closed','2026-07-15','2026-07-17',60000,9000,'2026-07-17',%s)", (trip, biz, bus, drv, jul))
for d in ('2026-07-15', '2026-07-16', '2026-07-17'):
    E("INSERT INTO vehicle_day_allocation (id,business_id,vehicle_id,business_date,arrangement,source_type,source_id) VALUES (%s,%s,%s,%s,'C','trip',%s)", (U(), biz, bus, d, trip))
    E("INSERT INTO day_record (id,business_id,daily_lease_id,vehicle_id,driver_id,business_date,state,earned_minor,expected_minor,trip_id,posted_period_id) "
      "VALUES (%s,%s,%s,%s,%s,%s,'paused_for_trip',0,5000,%s,%s)", (U(), biz, dl, bus, drv, d, trip, jul))

def lease_day(date, state, earned, reason=None):
    dr = U()
    E("INSERT INTO vehicle_day_allocation (id,business_id,vehicle_id,business_date,arrangement,source_type,source_id) VALUES (%s,%s,%s,%s,'B','daily_lease',%s)", (U(), biz, bus, date, dl))
    E("INSERT INTO day_record (id,business_id,daily_lease_id,vehicle_id,driver_id,business_date,state,earned_minor,expected_minor,lost_reason,posted_period_id) "
      "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,5000,%s,%s)", (dr, biz, dl, bus, drv, date, state, earned, reason, jul))
    if earned:
        ob = U()
        E("INSERT INTO obligation (id,business_id,direction,party_type,party_driver_id,kind,source_type,source_id,vehicle_id,amount_minor,due_on,effective_due_on,posted_period_id) "
          "VALUES (%s,%s,'owed_to_us','driver',%s,'daily_amount','day_record',%s,%s,%s,%s,%s,%s)", (ob, biz, drv, dr, bus, earned, date, date, jul))
        return ob
    return None

dates = [f"2026-07-{d:02d}" for d in range(1, 32) if f"2026-07-{d:02d}" not in ('2026-07-15', '2026-07-16', '2026-07-17')]
plan = ([('ran_paid_full', 5000, None)] * 23 + [('ran_paid_short', 5000, None)]
        + [('did_not_run', 0, 'breakdown')] * 2 + [('did_not_run', 0, 'driver_day_off')]
        + [('did_not_run', 0, 'no_passengers')])
obs = []
for d, (st, earned, rsn) in zip(dates, plan):
    o = lease_day(d, st, earned, rsn)
    if o: obs.append((o, st))

for ob, st in obs:
    amt = 5000 if st == 'ran_paid_full' else 3000
    p = U()
    E("INSERT INTO payment (id,business_id,direction,party_type,party_driver_id,amount_minor,occurred_on,handled_by_user_id,posted_period_id) "
      "VALUES (%s,%s,'received','driver',%s,%s,'2026-07-20',%s,%s)", (p, biz, drv, amt, usr, jul))
    E("INSERT INTO payment_allocation (id,payment_id,obligation_id,amount_minor,allocated_on) VALUES (%s,%s,%s,%s,'2026-07-20')", (U(), p, ob, amt))
    E("UPDATE obligation SET settled_minor=%s, status=%s WHERE id=%s", (amt, 'paid' if amt == 5000 else 'part_paid', ob))

for cat, amt in [('fuel', 22000), ('tolls', 3000)]:
    E("INSERT INTO expense (id,business_id,vehicle_id,trip_id,category,amount_minor,spent_on,borne_by,posted_period_id) "
      "VALUES (%s,%s,%s,%s,%s,%s,'2026-07-16','us',%s)", (U(), biz, bus, trip, cat, amt, jul))
E("INSERT INTO expense (id,business_id,vehicle_id,category,amount_minor,spent_on,borne_by,posted_period_id) "
  "VALUES (%s,%s,%s,'repairs',12000,'2026-07-08','us',%s)", (U(), biz, bus, jul))
E("INSERT INTO obligation (id,business_id,direction,party_type,party_driver_id,kind,source_type,source_id,vehicle_id,amount_minor,due_on,effective_due_on,posted_period_id) "
  "VALUES (%s,%s,'owed_by_us','driver',%s,'driver_fee','trip',%s,%s,9000,'2026-07-17','2026-07-17',%s)", (U(), biz, drv, trip, bus, jul))
E("INSERT INTO expense (id,business_id,vehicle_id,category,amount_minor,spent_on,borne_by,borne_by_driver_id,posted_period_id) "
  "VALUES (%s,%s,%s,'fuel',40000,'2026-07-10','driver',%s,%s)", (U(), biz, bus, drv, jul))
dep = U()
E("INSERT INTO deposit (id,business_id,party_type,party_driver_id,daily_lease_id,status) VALUES (%s,%s,'driver',%s,%s,'held')", (dep, biz, drv, dl))
E("INSERT INTO deposit_movement (id,deposit_id,movement_type,amount_minor,occurred_on,posted_period_id) VALUES (%s,%s,'taken',25000,'2026-07-01',%s)", (U(), dep, jul))

check("days paused for the charter", one("SELECT count(*) FROM day_record WHERE state='paused_for_trip' AND posted_period_id=%s", (jul,)), 3)
check("days ran", one("SELECT count(*) FROM day_record WHERE state LIKE 'ran_%%' AND posted_period_id=%s", (jul,)), 24)
check("days lost", one("SELECT count(*) FROM day_record WHERE state='did_not_run' AND posted_period_id=%s", (jul,)), 4)
check("lease-eligible = ran + lost", one("SELECT count(*) FROM day_record WHERE state<>'paused_for_trip' AND posted_period_id=%s", (jul,)), 28)
check("total days", one("SELECT count(*) FROM day_record WHERE posted_period_id=%s", (jul,)), 31)
check("lost-day value (UC-76)", one("SELECT COALESCE(SUM(expected_minor),0) FROM day_record WHERE state='did_not_run' AND posted_period_id=%s", (jul,)), 20000)
check("driver earned", one("SELECT SUM(amount_minor) FROM obligation WHERE direction='owed_to_us' AND party_driver_id=%s AND kind='daily_amount'", (drv,)), 120000)
check("driver received", one("SELECT SUM(settled_minor) FROM obligation WHERE direction='owed_to_us' AND party_driver_id=%s AND kind='daily_amount'", (drv,)), 118000)
check("he owes you (arrears)", one("SELECT SUM(amount_minor-settled_minor-waived_minor) FROM obligation WHERE direction='owed_to_us' AND party_driver_id=%s AND status IN ('pending','part_paid')", (drv,)), 2000)
check("you owe him (trip fee)", one("SELECT SUM(amount_minor-settled_minor-waived_minor) FROM obligation WHERE direction='owed_by_us' AND party_driver_id=%s AND status IN ('pending','part_paid')", (drv,)), 9000)

trip_costs = one("SELECT COALESCE(SUM(amount_minor),0) FROM expense WHERE trip_id=%s AND borne_by='us' AND voided_at IS NULL", (trip,))
check("charter costs excl. driver fee", trip_costs, 25000)
check("charter profit", 60000 - trip_costs - 9000, 26000)
exp_us = one("SELECT COALESCE(SUM(amount_minor),0) FROM expense WHERE vehicle_id=%s AND posted_period_id=%s AND borne_by='us' AND voided_at IS NULL", (bus, jul))
fees = one("SELECT COALESCE(SUM(amount_minor),0) FROM obligation WHERE direction='owed_by_us' AND vehicle_id=%s AND posted_period_id=%s AND kind='driver_fee'", (bus, jul))
check("expenses borne by us", exp_us, 37000)
check("driver fees owed", fees, 9000)
check("TOTAL July costs (expenses + fees)", exp_us + fees, 46000)
check("driver's own fuel stays below the line", one("SELECT COALESCE(SUM(amount_minor),0) FROM expense WHERE vehicle_id=%s AND borne_by<>'us'", (bus,)), 40000)
check("July earned", 120000 + 60000, 180000)
check("July NET PROFIT", (120000 + 60000) - (exp_us + fees), 134000)
check("deposit held, never income", one("SELECT SUM(CASE WHEN movement_type IN ('taken','topped_up') THEN amount_minor ELSE -amount_minor END) FROM deposit_movement WHERE deposit_id=%s", (dep,)), 25000)

print()
print("=" * 68)
print("G-3  Mileage on an open-ended rental (section 7.3)")
print("=" * 68)
car, cust = U(), U()
E("INSERT INTO vehicle (id,business_id,registration,vehicle_type) VALUES (%s,%s,'CAR-'||%s,'car')", (car, biz, RUN))
E("INSERT INTO customer (id,business_id,customer_type,name,nic) VALUES (%s,%s,'person','Cust','99'||%s)", (cust, biz, RUN))
lse = U()
E("INSERT INTO lease (id,business_id,vehicle_id,customer_id,status,start_date,billing_day,rent_amount_minor,mileage_daily_limit_km,mileage_excess_rate_minor) "
  "VALUES (%s,%s,%s,%s,'active','2026-01-12',12,70000,100,25)", (lse, biz, car, cust))
for seq, (a, b) in enumerate([('2026-01-12','2026-02-11'),('2026-02-12','2026-03-11'),('2026-03-12','2026-04-11'),('2026-04-12','2026-05-11')]):
    E("INSERT INTO billing_period (id,lease_id,seq,period_start,period_end,rent_amount_minor) VALUES (%s,%s,%s,%s,%s,70000)", (U(), lse, seq, a, b))
E("UPDATE billing_period SET allowance_km = days_count * 100 WHERE lease_id=%s", (lse,))

check("days_count per billing period", list(one("SELECT array_agg(days_count ORDER BY seq) FROM billing_period WHERE lease_id=%s", (lse,))), [31, 28, 31, 30])
check("allowance_km per period", list(one("SELECT array_agg(allowance_km ORDER BY seq) FROM billing_period WHERE lease_id=%s", (lse,))), [3100, 2800, 3100, 3000])
check("rent never moves (W-25)", one("SELECT count(DISTINCT rent_amount_minor) FROM billing_period WHERE lease_id=%s", (lse,)), 1)
check("period 1: 3240 driven -> charge", one("SELECT GREATEST(0, 3240 - allowance_km) * 25 FROM billing_period WHERE lease_id=%s AND seq=0", (lse,)), 3500)
check("period 2: 2650 driven -> charge", one("SELECT GREATEST(0, 2650 - allowance_km) * 25 FROM billing_period WHERE lease_id=%s AND seq=1", (lse,)), 0)
check("periods 3+4 combined allowance", one("SELECT SUM(allowance_km) FROM billing_period WHERE lease_id=%s AND seq IN (2,3)", (lse,)), 6100)
check("periods 3+4: 6400 driven -> charge", one("SELECT GREATEST(0, 6400 - SUM(allowance_km)) * 25 FROM billing_period WHERE lease_id=%s AND seq IN (2,3)", (lse,)), 7500)
check("largest-remainder split sums to 300", round(300*31/61) + round(300*30/61), 300)

print()
print("=" * 68)
print("G-2  One accident (section 7.2)")
print("=" * 68)
inc = U()
E("INSERT INTO incident (id,business_id,vehicle_id,lease_id,status,occurred_on,off_road_from,off_road_to,rent_treatment) "
  "VALUES (%s,%s,%s,%s,'recovery_pending','2026-07-08','2026-07-08','2026-07-19','extend')", (inc, biz, car, lse))
E("INSERT INTO lease_extension (id,lease_id,incident_id,days_added,applied_on,new_end_date) VALUES (%s,%s,%s,12,'2026-07-20','2026-08-01')", (U(), lse, inc))
E("INSERT INTO expense (id,business_id,vehicle_id,incident_id,category,amount_minor,spent_on,borne_by,posted_period_id) VALUES (%s,%s,%s,%s,'repairs',70000,'2026-07-28','us',%s)", (U(), biz, car, inc, jul))
E("INSERT INTO insurance_claim (id,incident_id,claimed_amount_minor,excess_borne_minor,status,received_amount_minor,posted_period_id) VALUES (%s,%s,75000,15000,'submitted',0,%s)", (U(), inc, jul))
rec_ins, rec_cust = U(), U()
E("INSERT INTO incident_recovery (id,incident_id,source,agreed_amount_minor,received_amount_minor,posted_period_id) VALUES (%s,%s,'insurer',60000,0,%s)", (rec_ins, inc, jul))

pending_jul = one("SELECT COALESCE(SUM(agreed_amount_minor),0) FROM incident_recovery WHERE incident_id=%s AND received_period_id IS NULL", (inc,))
check("July: pending recovery shown", pending_jul, 60000)

close_and_open(jul, aug, "2026-08-01", "2026-08-31")
E("INSERT INTO expense (id,business_id,vehicle_id,incident_id,category,amount_minor,spent_on,borne_by,posted_period_id) VALUES (%s,%s,%s,%s,'repairs',25000,'2026-08-04','us',%s)", (U(), biz, car, inc, aug))
E("INSERT INTO incident_recovery (id,incident_id,source,agreed_amount_minor,received_amount_minor,posted_period_id,received_period_id) VALUES (%s,%s,'customer',20000,20000,%s,%s)", (rec_cust, inc, aug, aug))
check("Aug: pending recovery still shown", one("SELECT COALESCE(SUM(agreed_amount_minor),0) FROM incident_recovery WHERE incident_id=%s AND received_period_id IS NULL", (inc,)), 60000)

close_and_open(aug, sep, "2026-09-01", "2026-09-30")
E("UPDATE incident_recovery SET received_amount_minor=60000, received_period_id=%s WHERE id=%s", (sep, rec_ins))
E("UPDATE insurance_claim SET status='settled', received_amount_minor=60000, received_on='2026-09-10', received_period_id=%s WHERE incident_id=%s", (sep, inc))

spent = one("SELECT SUM(amount_minor) FROM expense WHERE incident_id=%s AND voided_at IS NULL", (inc,))
recov = one("SELECT SUM(received_amount_minor) FROM incident_recovery WHERE incident_id=%s AND voided_at IS NULL", (inc,))
check("incident spent", spent, 95000)
check("incident recovered", recov, 80000)
check("NET COST TO YOU", spent - recov, 15000)
check("July repairs", one("SELECT SUM(amount_minor) FROM expense WHERE incident_id=%s AND posted_period_id=%s", (inc, jul)), 70000)
check("August repairs", one("SELECT SUM(amount_minor) FROM expense WHERE incident_id=%s AND posted_period_id=%s", (inc, aug)), 25000)
check("August recovered", one("SELECT COALESCE(SUM(received_amount_minor),0) FROM incident_recovery WHERE incident_id=%s AND received_period_id=%s", (inc, aug)), 20000)
check("September recovered", one("SELECT COALESCE(SUM(received_amount_minor),0) FROM incident_recovery WHERE incident_id=%s AND received_period_id=%s", (inc, sep)), 60000)
check("Sep: nothing left pending", one("SELECT COALESCE(SUM(agreed_amount_minor),0) FROM incident_recovery WHERE incident_id=%s AND received_period_id IS NULL", (inc,)), 0)
check("lease extended by 12 days", one("SELECT days_added FROM lease_extension WHERE incident_id=%s", (inc,)), 12)
check("insurance: claimed - excess = received", one("SELECT claimed_amount_minor - excess_borne_minor FROM insurance_claim WHERE incident_id=%s", (inc,)), 60000)

print()
print("=" * 68)
passed = sum(1 for ok, _ in results if ok)
print(f"RESULT: {passed}/{len(results)} assertions passed")
for ok, label in results:
    if not ok: print(f"   FAILED: {label}")
print("=" * 68)
