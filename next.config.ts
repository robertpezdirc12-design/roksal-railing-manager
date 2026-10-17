import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
// R543: CSP politiko gradi EN VIR — src/lib/csp.ts (čist modul brez uvozov;
// jiti prevede TS uvoz v next.config.ts). Način iz env: CSP_MODE (privzeto
// 'report' — opazovalno obdobje R536 nadaljuje), frame-ancestors samo
// izrecno (CSP_FRAME_ANCESTORS), 'unsafe-eval' samo v razvoju (NODE_ENV).
import { buildCsp } from "./src/lib/csp";

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

// R543: CSP iz environmenta — CSP_MODE ('report' privzeto | 'enforce'),
// CSP_FRAME_ANCESTORS (neobvezno, npr. 'none'), NODE_ENV (dev doda
// 'unsafe-eval' — kot doslej). Glava ostane Report-Only, dokler lastnik
// po pregledu zbranih poročil (tabela CspReport) ne preklopi v enforce.
const csp = buildCsp({
  mode: process.env.CSP_MODE === "enforce" ? "enforce" : "report",
  env: process.env.NODE_ENV === "production" ? "production" : "dev",
  frameAncestors: process.env.CSP_FRAME_ANCESTORS?.trim() || undefined,
});

const nextConfig: NextConfig = {
  output: "standalone",
  // R496 (izrec audita): varnostne glave. CSP je od R536 v politiki (od R543
  // prek buildCsp zgoraj — glej komentar ob glavi).
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
        // R536 → R543: CSP politika. Privzeto (brez env) = Report-Only glava
        // kot doslej + frame-src 'self' blob: (PDF predogled; varen dodatek
        // tudi v report načinu — poročila o njem so dobrodošla). Preklop v
        // IZVRŠILNI način je env stikalo CSP_MODE=enforce (po pregledu
        // zbranih poročil v tabeli CspReport); frame-ancestors se vključi
        // SAMO izrecno prek CSP_FRAME_ANCESTORS (peskovniški predogled
        // iframe bi ga prelomil — zaščita teče prek X-Frame-Options zgoraj).
        // unsafe-inline/unsafe-eval sta nujna za Next.js (hidracija/injektirani
        // slogi; dev strežnik uporablja eval) — eval SAMO v dev (buildCsp).
        // Poročila tečejo na /api/csp-report (tempomat + zapis v bazo, R543).
        {
          key: csp.headerName,
          value: csp.policy,
        },
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

// R543: glava CSP se izračuna ob zagonu (env stikala glej zgoraj) — sprememba
// CSP_MODE/CSP_FRAME_ANCESTORS zahteva ponovni zagon strežnika (namenoma:
// varnostna politika se NE spreminja sredi življenjske dobe procesa).
