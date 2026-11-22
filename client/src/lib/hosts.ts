// Production serves one build on three hosts (P8 PR 05b): the apex for customers, `staff.` for the board and
// /manage, `admin.` for /admin. Each host is its own browser origin, so each keeps its own sign-in. With the host
// names unset (local, CI, the staging build) every section stays on one origin with paths, and nothing here acts.

export type Section = 'customer' | 'staff' | 'admin';
export interface Hosts {
  customer?: string;
  staff?: string;
  admin?: string;
}
interface Place {
  /** location.host: the name, and the port when there is one. */
  host: string;
  protocol: string;
  pathname: string;
  search: string;
  hash: string;
}

const SECTION_HOME: Record<Section, string> = { customer: '/', staff: '/staff', admin: '/admin' };
// Signing in, registering and the profile (with its sign-out) work on every host.
const SHARED = ['/login', '/register', '/profile'];

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The section a path belongs to, or null for a path every host serves. Lower-cased first: the router matches routes
 * case-insensitively, so `/Admin` must leave the apex like `/admin`.
 */
export function sectionOfPath(path: string): Section | null {
  const pathname = path.toLowerCase();
  if (SHARED.some((p) => under(pathname, p))) return null;
  if (['/staff', '/manage', '/join'].some((p) => under(pathname, p))) return 'staff';
  if (under(pathname, '/admin')) return 'admin';
  return 'customer';
}

const configured = (hosts: Hosts): hosts is Required<Hosts> =>
  Boolean(hosts.customer && hosts.staff && hosts.admin);

/** Null for a host that is none of the three (CloudFront's own name before go-live): no routing by host there. */
function sectionOfHost(host: string, hosts: Hosts): Section | null {
  if (!configured(hosts)) return null;
  // Host names are case-insensitive: a build value written in capitals must still match location.host.
  const same = (setting: string) => setting.toLowerCase() === host.toLowerCase();
  if (same(hosts.customer)) return 'customer';
  if (same(hosts.staff)) return 'staff';
  if (same(hosts.admin)) return 'admin';
  return null;
}

/**
 * Where this address should be instead, or null to stay: a full URL on another host for a path of another section
 * (old links and bookmarks still land, the invite's fragment included), or the section's home for `/` on `staff.`
 * and `admin.`.
 */
export function hostRedirect(place: Place, hosts: Hosts): string | null {
  const here = sectionOfHost(place.host, hosts);
  if (here === null || !configured(hosts)) return null;
  // The query and fragment ride along, as they do across hosts below.
  if (place.pathname === '/' && here !== 'customer')
    return `${SECTION_HOME[here]}${place.search}${place.hash}`;
  const wanted = sectionOfPath(place.pathname);
  if (wanted === null || wanted === here) return null;
  return `${place.protocol}//${hosts[wanted]}${place.pathname}${place.search}${place.hash}`;
}

/** A link to `path`: the path itself on its own host, a full URL when it lives on another. */
export function hrefFor(path: string, place: Pick<Place, 'host' | 'protocol'>, hosts: Hosts) {
  const here = sectionOfHost(place.host, hosts);
  const wanted = sectionOfPath(path);
  if (here === null || !configured(hosts) || wanted === null || wanted === here) return path;
  return `${place.protocol}//${hosts[wanted]}${path}`;
}

/** After sign-in: `target` when this host serves it, else this host's own home (a sign-in here is for here). */
export function homeOnHost(target: string, host: string, hosts: Hosts): string {
  const here = sectionOfHost(host, hosts);
  const wanted = sectionOfPath(target);
  return here === null || wanted === null || wanted === here ? target : SECTION_HOME[here];
}
