export function normalizeChannelName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}
