export function getSafeNextPath(next: string | null, origin: string): string {
  if (!next) {
    return "/dashboard";
  }

  if (next.includes("\\")) {
    return "/";
  }

  try {
    const target = new URL(next, origin);
    if (target.origin !== origin) {
      return "/";
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}
