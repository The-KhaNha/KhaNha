/** major, minor, patch of a `x.y.z` or `x.y.z-label` version; undefined when it is not one. */
export function parseSemver(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/**
 * Negative when a < b, 0 when equal, positive when a > b, on the numeric triple only: a prerelease label is ignored,
 * so a staging build `0.4.0-dev.3` is never "older" than a `min_client_version` of `0.4.0`. Unparseable sorts first.
 */
export function compareSemver(a: string, b: string): number {
  const [x, y] = [parseSemver(a), parseSemver(b)];
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  const [a1, a2, a3] = x;
  const [b1, b2, b3] = y;
  return a1 - b1 || a2 - b2 || a3 - b3;
}
