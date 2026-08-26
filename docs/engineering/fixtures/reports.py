"""Execute the remaining section 15 report queries against the populated fixture branch."""
import os, ssl, sys
import pg8000.dbapi

# SonarCloud, PR #129: the Neon role password used to live here as a literal —
# see golden.py's own comment for the account (it matches DATABASE_URL's
# `main`-branch password, so this was the production credential, and it must
# still be rotated in the Neon console). This script now takes it from
# PGPASSWORD (the standard libpq env var) instead.
password = os.environ.get("PGPASSWORD")
if not password:
    sys.exit("PGPASSWORD must be set — the Neon role's password, never committed here")

# See golden.py's own comment: built explicitly so SonarCloud's S4423/S4830
# can see a pinned minimum_version statically, same behaviour either way.
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
ssl_context.verify_mode = ssl.CERT_REQUIRED
ssl_context.check_hostname = True
ssl_context.load_default_certs()

conn = pg8000.dbapi.connect(user="neondb_owner", password=password,
    host=sys.argv[1], database="neondb", ssl_context=ssl_context)
conn.autocommit = True
cur = conn.cursor()
cur.execute("SET statement_timeout='20s'")

def run(label, sql, args=None):
    print(f"\n--- {label}")
    try:
        cur.execute(sql, args) if args else cur.execute(sql)
        rows = cur.fetchall()
        cols = [d[0] for d in cur.description]
        print("    " + " | ".join(str(c) for c in cols))
        for r in rows[:8]:
            print("    " + " | ".join(str(v) for v in r))
        if not rows: print("    (no rows)")
    except Exception as e:
        import re
        m = re.search(r"'M': '([^']*)'", str(e))
        print(f"    ERROR: {m.group(1) if m else str(e)[:200]}")

cur.execute("SELECT id FROM business LIMIT 1"); biz = cur.fetchone()[0]

run("UC-76 lost days per driver per month", """
SELECT driver_id,
       COUNT(*) FILTER (WHERE state = 'did_not_run')            AS lost,
       COUNT(*) FILTER (WHERE state LIKE 'ran_%')               AS ran,
       COUNT(*)                                                 AS lease_eligible,
       SUM(expected_minor) FILTER (WHERE state = 'did_not_run') AS lost_value_minor
  FROM day_record
 WHERE business_id = %s AND business_date BETWEEN '2026-07-01' AND '2026-07-31'
   AND state <> 'paused_for_trip'
 GROUP BY driver_id""", (biz,))

run("UC-74 / UC-78 who owes us, bucketed", """
SELECT party_type,
       SUM(amount_minor - settled_minor - waived_minor) AS outstanding_minor,
       MIN(effective_due_on)                            AS oldest,
       CASE WHEN CURRENT_DATE - MIN(effective_due_on) <= 0  THEN 'current'
            WHEN CURRENT_DATE - MIN(effective_due_on) <= 30 THEN '1-30'
            WHEN CURRENT_DATE - MIN(effective_due_on) <= 60 THEN '31-60'
            WHEN CURRENT_DATE - MIN(effective_due_on) <= 90 THEN '61-90'
            ELSE 'over-90' END AS bucket
  FROM obligation
 WHERE business_id = %s AND direction = 'owed_to_us'
   AND status IN ('pending','part_paid')
 GROUP BY party_type""", (biz,))

run("UC-56 driver's two balances, unmerged", """
SELECT direction, SUM(amount_minor - settled_minor - waived_minor) AS balance_minor
  FROM obligation
 WHERE party_driver_id = (SELECT id FROM driver LIMIT 1)
   AND status IN ('pending','part_paid')
 GROUP BY direction""")

run("UC-75 where is our cash, held per partner", """
SELECT u.id, u.display_name,
       COALESCE(r.total,0) - COALESCE(b.total,0) - COALESCE(a.total,0) AS held_minor
  FROM app_user u
  LEFT JOIN (SELECT handled_by_user_id uid, SUM(amount_minor) total
               FROM payment
              WHERE direction='received' AND status='active'
              GROUP BY 1) r ON r.uid = u.id
  LEFT JOIN (SELECT from_user_id uid, SUM(amount_counted_minor) total
               FROM banking_event WHERE voided_at IS NULL GROUP BY 1) b ON b.uid = u.id
  LEFT JOIN (SELECT issued_by_user_id uid, SUM(amount_minor) total
               FROM advance
              WHERE status <> 'settled' AND voided_at IS NULL
              GROUP BY 1) a ON a.uid = u.id
 WHERE u.id IN (SELECT user_id FROM business_member
                 WHERE business_id = %s AND revoked_at IS NULL)""", (biz,))

run("UC-98 pre-close checklist, unconfirmed days", """
SELECT vehicle_id, business_date, expected_minor
  FROM day_record
 WHERE business_id = %s AND state = 'open'
   AND business_date BETWEEN '2026-07-01' AND '2026-07-31'
 ORDER BY business_date""", (biz,))

run("UC-70 vehicle month costs (expenses UNION driver fees)", """
SELECT COALESCE(SUM(amount_minor),0) AS costs_minor FROM (
  SELECT amount_minor FROM expense
   WHERE vehicle_id=(SELECT id FROM vehicle WHERE vehicle_type='bus' LIMIT 1)
     AND posted_period_id=(SELECT id FROM accounting_period WHERE period_start='2026-07-01')
     AND borne_by='us' AND voided_at IS NULL
  UNION ALL
  SELECT amount_minor FROM obligation
   WHERE vehicle_id=(SELECT id FROM vehicle WHERE vehicle_type='bus' LIMIT 1)
     AND posted_period_id=(SELECT id FROM accounting_period WHERE period_start='2026-07-01')
     AND direction='owed_by_us' AND kind IN ('driver_fee','management_fee')
     AND voided_at IS NULL) c""")
