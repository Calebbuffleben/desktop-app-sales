/**
 * Same rules as backend/src/playbooks/playbook-resolver.lib.ts — keep in sync.
 * Used by Electron main for desktop:open-external (https + hostname allowlist).
 */

export function parsePlaybookUrlAllowlistEnv(raw: string | undefined): Set<string> {
  const s = raw?.trim();
  if (!s) return new Set();
  return new Set(
    s
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0),
  );
}

function hostnameAllowed(hostname: string, allowlist: Set<string>): boolean {
  const h = hostname.toLowerCase();
  if (allowlist.has(h)) return true;
  for (const base of allowlist) {
    if (h.endsWith("." + base)) return true;
  }
  return false;
}

/** True if url is https and hostname matches allowlist (empty allowlist => deny). */
export function isHttpsUrlAllowedForPlaybook(
  urlString: string,
  allowlist: Set<string>,
): boolean {
  if (allowlist.size === 0) return false;
  try {
    const u = new URL(urlString);
    if (u.protocol !== "https:") return false;
    return hostnameAllowed(u.hostname, allowlist);
  } catch {
    return false;
  }
}
