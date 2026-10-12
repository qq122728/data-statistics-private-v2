/** ASCII buyer names (e.g. C) must not match inside words such as Excel. */
export function mentionsQueryName(text: string, name: string) {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^[a-z0-9]/i.test(name) ? "(?<![a-z0-9])" : "";
  const right = /[a-z0-9]$/i.test(name) ? "(?![a-z0-9])" : "";
  return new RegExp(left + escaped + right, "i").test(text);
}
