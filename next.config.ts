import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Browser tests can run while a developer previews the app. Give their
  // temporary build output its own folder so two `next dev` processes never
  // write the same manifest at once.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // 本地预览既可能从 localhost 打开，也可能从 127.0.0.1 打开；两者都放行，
  // 否则 Next 会拦截热更新资源，页面会出现样式或最新代码没有刷新的假象。
  allowedDevOrigins: process.env.NODE_ENV === "development" || process.env.E2E_PORT
    ? ["127.0.0.1", "localhost"]
    : undefined,
};

export default nextConfig;
