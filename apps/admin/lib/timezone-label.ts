const LABELS: Record<string, string> = {
  "America/New_York": "美东时间",
  "America/Los_Angeles": "美西时间",
  "Europe/Berlin": "德国时间",
  "Europe/London": "英国时间",
  "Asia/Shanghai": "中国时间",
  UTC: "协调世界时",
};

export function timezoneLabel(timezone: string): string {
  return LABELS[timezone] ?? timezone.replaceAll("_", " ");
}
