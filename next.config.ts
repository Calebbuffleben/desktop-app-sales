import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "export",
  images: {
    unoptimized: true,
  },
  // Electron carrega `out/*.html` via file:// — rotas absolutas `/_next/...` quebram o CSS/JS.
  // `./` faz os assets apontarem para `out/_next/...` em relação a cada HTML.
  assetPrefix: process.env.NODE_ENV === "production" ? "./" : undefined,
};

export default nextConfig;
