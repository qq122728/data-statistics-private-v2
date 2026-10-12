export function materialLink(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length > 2048) throw new Error("素材链接不能超过 2048 个字符");
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error("素材链接需要填写完整的 http 或 https 地址"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("素材链接只支持 http 或 https 地址");
  return parsed.toString();
}
