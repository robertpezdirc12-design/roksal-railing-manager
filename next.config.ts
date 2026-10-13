import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// R478 (issue #9 §6): build oznaka se razreši OB BUILDU/ZAGONU — ne več
// statična env vrednost, ki jo je treba ročno osveževati na Vercelu.
// Prednost: VERCEL_GIT_COMMIT_SHA (git deploy: "main-31e4f4d" — PRAVI sha
// builda, ročna env oznaka ga NE sme pasti, ker zastara) → ROKSAL_BUILD
// (izrecna ročna oznaka — samo brez git deploya) → dev-v<verzija> (lokalno).
function resolveBuildLabel (): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  if (sha) {
    const ref = process.env.VERCEL_GIT_COMMIT_REF ?? "main"
    return `${ref}-${sha.slice(0, 7)}`
  }
  if (process.env.ROKSAL_BUILD) return process.env.ROKSAL_BUILD
  try {
    const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string }
    return `dev-v${pkg.version ?? "0"}`
  } catch {
    return "dev"
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  // R496 (izrec audita): varnostne glave. CSP NAMENO ni v tem koraku — zahteva
  // prehod na stagingu (Next injicira skripte, uporablja se Blob slike, AR kamera);
  // napačno nastavljen CSP bi zlomil prijavo in AR modul.
  // Izbira je konservativna in preverjena glede na dejansko rabo v kodi:
  //  • Permissions-Policy pustuje camera/geolocation (ar.tsx, meritve-kamera.tsx,
  //    measure-engine.ts) — izklopljen je samo microphone, ki ga aplikacija ne rabi;
  //  • brez COOP/COEP: vsi window.open klici so že 'noopener', COEP pa bi zlomil
  //    vloge iz Vercel Bloba (foto, PDF, viz renderji).
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
      ],
    },
  ],
  // R464 (issue #1 §6): production build NE sme ignorirati TypeScript napak.
  // CI in build imata enako semantiko tipovne pravilnosti (tsc --noEmit + next build).
  reactStrictMode: false,
  // R478: razrešena build oznaka (inline ob buildu; runtime ROKSAL_BUILD ima
  // prednost v API-jih, ki berejo process.env)
  env: { ROKSAL_BUILD_RESOLVED: resolveBuildLabel() },
};

export default nextConfig;
