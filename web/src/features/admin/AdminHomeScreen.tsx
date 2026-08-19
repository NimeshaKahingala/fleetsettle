import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Inbox, Landmark, ScrollText, ShieldCheck, Users } from "lucide-react";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";

/**
 * Design §8.2/UI §3.1: the platform surface's own hub, the "admin panel"
 * every entry point (`MoreScreen`'s row, `FirstRunGate`'s zero-membership
 * door) leads to — not a fourth business-role shell (M-3), so this has no
 * tab bar of its own (`AppShell shell="admin"` carries none) and no
 * `onBack`, the same reasoning `MoreScreen` itself has none: it is the top
 * of its own surface, not a drill-down from one.
 */
export function AdminHomeScreen() {
  const navigate = useNavigate();

  return (
    <Screen title="Admin panel">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void navigate({ to: "/admin/requests" })}
          className="w-full text-left"
        >
          <Card className="flex items-center gap-3">
            <Inbox className="size-5 text-ink-secondary" aria-hidden />
            <span className="flex-1 text-body text-ink-primary">Request queue</span>
            <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </Card>
        </button>

        <button
          type="button"
          onClick={() => void navigate({ to: "/admin/businesses" })}
          className="w-full text-left"
        >
          <Card className="flex items-center gap-3">
            <Landmark className="size-5 text-ink-secondary" aria-hidden />
            <span className="flex-1 text-body text-ink-primary">Businesses</span>
            <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </Card>
        </button>

        <button
          type="button"
          onClick={() => void navigate({ to: "/admin/users" })}
          className="w-full text-left"
        >
          <Card className="flex items-center gap-3">
            <Users className="size-5 text-ink-secondary" aria-hidden />
            <span className="flex-1 text-body text-ink-primary">Users</span>
            <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </Card>
        </button>

        <button
          type="button"
          onClick={() => void navigate({ to: "/admin/admins" })}
          className="w-full text-left"
        >
          <Card className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-ink-secondary" aria-hidden />
            <span className="flex-1 text-body text-ink-primary">Admin management</span>
            <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </Card>
        </button>

        <button
          type="button"
          onClick={() => void navigate({ to: "/admin/audit-log" })}
          className="w-full text-left"
        >
          <Card className="flex items-center gap-3">
            <ScrollText className="size-5 text-ink-secondary" aria-hidden />
            <span className="flex-1 text-body text-ink-primary">Platform log</span>
            <ChevronRight className="size-4 text-ink-muted" aria-hidden />
          </Card>
        </button>
      </div>
    </Screen>
  );
}
