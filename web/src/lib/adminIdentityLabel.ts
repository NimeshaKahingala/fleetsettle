/**
 * Decision 28 (`PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md`):
 * `display_name` is nullable by schema regardless of the Asgardeo console's
 * claims mapping, and a user may genuinely never have set one — the
 * fallback is not temporary scaffolding, it is permanent. Used wherever the
 * admin panel renders a raw `{ email, displayName }` pair straight off
 * `adminUserSchema`/`platformAdminSchema` — the requests list and the
 * platform audit log carry an already-resolved name field from the server
 * (`requesterName`/`actorName`) and don't need this.
 */
export function adminIdentityLabel(identity: {
  email: string | null;
  displayName: string | null;
}): string {
  return identity.displayName ?? identity.email ?? "Unnamed user";
}
