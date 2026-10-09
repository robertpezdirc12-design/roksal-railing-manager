import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // R464 (issue #1 §6): production build NE sme ignorirati TypeScript napak.
  // CI in build imata enako semantiko tipovne pravilnosti (tsc --noEmit + next build).
  reactStrictMode: false,
};

export default nextConfig;
