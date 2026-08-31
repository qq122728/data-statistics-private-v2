import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "*.localtest.me"],
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:3003";
    return [{
      source: "/api/:path*",
      destination: `${backendOrigin}/api/:path*`,
      basePath: false,
    }];
  },
};

export default nextConfig;
