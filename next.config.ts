import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// R478 (issue #9 §6): build oznaka se razreši OB BUILDU/ZAGONU — ne več
// statična env vrednost, ki jo je treba ročno osveževati na Vercelu.
// Prednost: ROKSAL_BUILD (izrecna) → VERCEL_GIT_COMMIT_SHA (git deploy:
// "main-9f980c4") → dev-v<verzija> (lokalni razvoj).
function resolveBuildLabel (): string {
  if (process.env.ROKSAL_BUILD) return process.env.ROKSAL_BUILD
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  if (sha) {
    const ref = process.env.VERCEL_GIT_COMMIT_REF ?? "main"
    return `${ref}-${sha.slice(0, 7)}`
  }
  try {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string }
    return `dev-v${pkg.version ?? "0"}`
  } catch {
    return "dev"
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  // R464 (issue #1 §6): production build NE sme ignorirati TypeScript napak.
  // CI in build imata enako semantiko tipovne pravilnosti (tsc --noEmit + next build).
  reactStrictMode: false,
  // R478: razrešena build oznaka (inline ob buildu; runtime ROKSAL_BUILD ima
  // prednost v API-jih, ki berejo process.env)
  env: { ROKSAL_BUILD_RESOLVED: resolveBuildLabel() },
};

export default nextConfig;
