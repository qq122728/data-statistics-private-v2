const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Keep local sign-in on the browser's current host so its session cookie follows the redirect. */
export function localWorkspaceOrigin(configured: string): string {
  if (typeof window === "undefined") return configured;
  const currentHost = window.location.hostname;
  if (!LOOPBACK_HOSTS.has(currentHost)) return configured;

  const target = new URL(configured);
  if (!LOOPBACK_HOSTS.has(target.hostname)) return configured;
  target.hostname = currentHost;
  return target.toString();
}
