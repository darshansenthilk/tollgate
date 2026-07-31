import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @tollgate/shared ships raw TypeScript from the workspace
  transpilePackages: ["@tollgate/shared"],
  // Traces a self-contained server + minimal node_modules into
  // .next/standalone — what frontend/dashboard/Dockerfile's runtime stage
  // copies, instead of hand-managing pnpm's symlinked node_modules across
  // Docker build stages. No effect on `next dev` or the existing Vercel
  // deploy (Vercel ignores this and uses its own build output).
  output: "standalone",
};

export default nextConfig;
