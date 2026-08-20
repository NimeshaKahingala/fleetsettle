/**
 * GAP-154: the paths an Operate role must never host under Operate chrome.
 *
 * `/me` is the linked driver's own-data shell and `/admin/*` is the platform
 * admin shell; either one mounting inside Operate would render a screen whose
 * data reads assume a different shell entirely. Both `FirstRunGate` (which
 * blocks the render before those screens mount) and `OperateLayout` (which
 * redirects to `/`) have to agree on the list, so it lives here rather than
 * being spelled out twice — the two copies agreed on the day they were
 * written, which is the only day a duplicated predicate ever does.
 */
export function isBlockedOperatePathname(pathname: string): boolean {
  return pathname === "/me" || pathname === "/admin" || pathname.startsWith("/admin/");
}
