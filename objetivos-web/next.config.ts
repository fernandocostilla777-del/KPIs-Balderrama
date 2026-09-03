import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    const backend = process.env.DASHBOARD_API_URL || "http://127.0.0.1:3000";
    return [
      {
        source: "/backend-api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
