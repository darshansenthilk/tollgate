import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @tollgate/shared ships raw TypeScript from the workspace
  transpilePackages: ["@tollgate/shared"],
};

export default nextConfig;
