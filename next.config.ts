import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [{
      source: "/reports/shared/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }];
  },
};

export default nextConfig;
