import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@livekit/rtc-node", "ws"],
};

export default nextConfig;
