import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSystemSettings } from "../lib/settings";

import "./globals.css";

const fallbackMetadata: Metadata = { title: "数据统计", description: "团队数据统计后台" };

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getSystemSettings();
    return { title: settings.appName, description: `${settings.appName}后台` };
  } catch {
    return fallbackMetadata;
  }
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
