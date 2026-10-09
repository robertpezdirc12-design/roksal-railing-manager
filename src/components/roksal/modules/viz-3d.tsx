'use client'

// VIZ-3D — 3D konfigurator ograje (R436, GitLab issue #1)
// LASTA perspektivna projekcija v čistem TypeScriptu (BREZ three.js):
//   točka (x, y, z) v cm → rotacija yaw (okoli Y) + pitch (okoli X) →
//   perspektiva s = f / (f − z'), f ≈ 700 → SVG viewBox 640×400.
// Datoteko delita viz.tsx (konfigurator + prikaz cene iz API-ja) in projekti.tsx
// (3D predogled shranjene konfiguracije na projektu).
// R464 (GitHub issue #1): ČISTA geometrija/prikaz/interakcija — NO cene, NO
// cenovne formule. Ocena cene teče izključno strežniško v pricing core-u
// (src/lib/product-core.ts, calcKonfigCena) prek POST /api/price-lists/calculate.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

// ─── deljene barve RAL (izvoz za viz.tsx) ─────────────────────────────────────

export const RAL_COLORS = [
  { id: 'antracit', label: 'Antracit RAL 7016', hex: '#2b2f36' },
  { id: 'bela', label: 'Bela RAL 9016', hex: '#f5f5f4' },
  { id: 'inox', label: 'Inox (srebrna)', hex: '#c0c5ce' },
  { id: 'bronasta', label: 'Bronasta', hex: '#8a6d3b' },
] as const

export type ColorId = (typeof RAL_COLORS)[number]['id']

export const ralHex = (id: string): string =>
  (RAL_COLORS.find((c) => c.id === id) ?? RAL_COLORS[0]).hex

export const ralLabel = (id: string): string =>
  (RAL_COLORS.find((c) => c.id === id) ?? RAL_COLORS[0]).label

export function isColorId (v: unknown): v is ColorId {
  return typeof v === 'string' && RAL_COLORS.some((c) => c.id === v)
}

// ─── tipi ograj ──────────────────────────────────────────────────────────────

export type KonfigTip = 'OGRAJA' | 'BALUSTRADA' | 'NAGIB'

export const TIP_LABELS: Record<KonfigTip, string> = {
  OGRAJA: 'Ograja — navpične palice',
  BALUSTRADA: 'Balustrada — steklo',
  NAGIB: 'Stopniški nagib',
}

export const TIP_SHORT: Record<KonfigTip, string> = {
  OGRAJA: 'ograja',
  BALUSTRADA: 'balustrada',
  NAGIB: 'stopniški nagib',
}

// ─── shranjena konfiguracija (params.konfigurator na meritvi) ────────────────

export interface KonfigParams {
  profileId: string | null
  sku: string | null
  colorId: ColorId
  tip: KonfigTip
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  slopeDeg: number
  material: string | null
}

function clampNum (v: unknown, min: number, max: number, fb: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fb
  return Math.min(max, Math.max(min, n))
}

/** Prebere params JSON meritve in vrne konfigurator (ali null, če ga ni). */
export function parseKonfigurator (params: string | null | undefined): KonfigParams | null {
  if (!params) return null
  try {
    const raw: unknown = JSON.parse(params)
    if (typeof raw !== 'object' || raw === null) return null
    const k = (raw as { konfigurator?: unknown }).konfigurator
    if (typeof k !== 'object' || k === null) return null
    const o = k as Record<string, unknown>
    return {
      profileId: typeof o.profileId === 'string' ? o.profileId : null,
      sku: typeof o.sku === 'string' ? o.sku : null,
      colorId: isColorId(o.colorId) ? o.colorId : 'antracit',
      tip: o.tip === 'BALUSTRADA' || o.tip === 'NAGIB' ? o.tip : 'OGRAJA',
      lengthCm: clampNum(o.lengthCm, 20, 6000, 400),
      heightCm: clampNum(o.heightCm, 20, 400, 110),
      posts: Math.round(clampNum(o.posts, 1, 40, 5)),
      handrail: typeof o.handrail === 'boolean' ? o.handrail : true,
      slopeDeg: clampNum(o.slopeDeg, 0, 60, 0),
      material: typeof o.material === 'string' ? o.material : null,
    }
  } catch {
    return null
  }
}

// ─── oblikovanje števil (čisti prikaz — brez poslovnih vrednosti) ────────────

export const fmtM = (cm: number): string => {
  const m = cm / 100
  return m.toFixed(m % 1 === 0 ? 0 : 2).replace('.', ',')
}

export const fmtQty = (n: number): string =>
  n.toLocaleString('sl-SI', { maximumFractionDigits: 2 })

// ─── barvni pomočniki ────────────────────────────────────────────────────────

function parseHex (hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return {
    r: parseInt(v.slice(0, 2), 16) || 0,
    g: parseInt(v.slice(2, 4), 16) || 0,
    b: parseInt(v.slice(4, 6), 16) || 0,
  }
}

/** Zameša barvo proti beli (t = 0 … 1) — za palice (rahlo svetlejše). */
export function lighten (hex: string, t: number): string {
  const { r, g, b } = parseHex(hex)
  const f = (c: number): number => Math.round(c + (255 - c) * t)
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Pomnoži svetlost (f > 1 svetlejše, f < 1 temnejše) — senčenje ploskev. */
function shadeColor (hex: string, f: number): string {
  const { r, g, b } = parseHex(hex)
  const m = (c: number): number => Math.min(255, Math.round(c * f))
  return `#${[m(r), m(g), m(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

// ─── izračun cene: R464 (GitHub issue #1) ─────────────────────────────────
// Vse poslovne cene in formule so IZSEL iz UI/3D kode. Ocena cene teče
// strežniško: POST /api/price-lists/calculate → src/lib/product-core.ts
// (calcKonfigCena) — PriceRule pravila cenika + Profile.pricePerM.
// Ta datoteka ostane ČISTA geometrija/prikaz/interakcija.

// ─── 3D projekcija ───────────────────────────────────────────────────────────

const F = 700          // goriščna razdalja
const VW = 640         // širina SVG platna
const DZ = 80          // globina talne ravnine (cm)
const GLASS_FILL = 'rgba(148, 163, 184, 0.28)'
const GLASS_STROKE = 'rgba(100, 116, 139, 0.55)'
const AMBER = '#b45309'
const GROUND_FILL = '#f1f5f9'
const GROUND_STROKE = '#e2e8f0'
const GRID_COLOR = '#cbd5e1'

interface Vec3 { x: number; y: number; z: number }
interface P2 { x: number; y: number; s: number; d: number }

interface Built { d: number; node: ReactNode }

interface SceneInput {
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  slopeDeg: number
  colorHex: string
  tip: KonfigTip
  yaw: number
  pitch: number
  hover: number | null
  vh: number
  onHover: (seg: number | null) => void
}

/** Zgradi vse primitive scene (tla, stebri, ročnik, polnilo) v svetovnih cm. */
function buildScene (inp: SceneInput): { below: ReactNode[]; prims: Built[]; hits: ReactNode[] } {
  const L = inp.lengthCm
  const tanS = Math.tan((inp.slopeDeg * Math.PI) / 180)
  // višina zgornjega roba na mestu x — pri nagibu linearno narašča/pada
  const topY = (x: number): number => inp.heightCm + x * tanS
  const maxTop = Math.max(topY(0), topY(L)) + (inp.handrail ? 10 : 4)
  const vh = inp.vh

  // rotacijski koeficienti (yaw okoli Y, pitch okoli X — stopinje → radiani)
  const cy = Math.cos((inp.yaw * Math.PI) / 180)
  const sy = Math.sin((inp.yaw * Math.PI) / 180)
  const cp = Math.cos((inp.pitch * Math.PI) / 180)
  const sp = Math.sin((inp.pitch * Math.PI) / 180)

  // merilo: prilagodi polmer footprinta in višino v platno
  const rx = Math.hypot(L / 2 + 40, DZ)
  const ry = maxTop / 2 + 8
  const scale = Math.min((VW / 2 - 56) / rx, (vh / 2 - 42) / ry) * 0.9
  const centerX = L / 2
  const centerY = maxTop / 2

  /** Projekcija svetovne točke → zaslon (perspektiva f/(f−z')). */
  const proj = (x: number, y: number, z: number): P2 => {
    const px = (x - centerX) * scale
    const py = (y - centerY) * scale
    const pz = z * scale
    const x1 = px * cy + pz * sy
    const z1 = -px * sy + pz * cy
    const y2 = py * cp - z1 * sp
    const z2 = py * sp + z1 * cp
    const s = F / Math.max(F * 0.3, F - z2)
    return { x: VW / 2 + x1 * s, y: vh / 2 - y2 * s, s, d: z2 }
  }

  // svetlobna smer v prostoru kamere (zgoraj / levo / proti gledalcu)
  const LX = -0.32, LY = 0.78, LZ = 0.54

  /** Zavrti normalo z isto rotacijo kot pri projekciji. */
  const rotN = (nx: number, ny: number, nz: number): Vec3 => {
    const x1 = nx * cy + nz * sy
    const z1 = -nx * sy + nz * cy
    return { x: x1, y: ny * cp - z1 * sp, z: ny * sp + z1 * cp }
  }

  const prims: Built[] = []
  const below: ReactNode[] = []
  const hits: ReactNode[] = []
  let seq = 0

  const pushPoly = (pts3: Vec3[], fill: string, stroke: string | null, sw: number, opacity: number): void => {
    const pp = pts3.map((p) => proj(p.x, p.y, p.z))
    prims.push({
      d: pp.reduce((s, q) => s + q.d, 0) / pp.length,
      node: (
        <polygon
          key={`p${seq++}`}
          points={pp.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}
          fill={fill}
          stroke={stroke ?? 'none'}
          strokeWidth={sw}
          strokeLinejoin="round"
          opacity={opacity}
        />
      ),
    })
  }

  /** Mrežna črta na tleh — vedno pod vsemi primitivami (railing je nad tlemi). */
  const pushGrid = (a: Vec3, b: Vec3, color: string, px: number, opacity: number): void => {
    const pa = proj(a.x, a.y, a.z)
    const pb = proj(b.x, b.y, b.z)
    below.push(
      <line
        key={`g${seq++}`}
        x1={pa.x.toFixed(1)} y1={pa.y.toFixed(1)}
        x2={pb.x.toFixed(1)} y2={pb.y.toFixed(1)}
        stroke={color} strokeWidth={px} strokeLinecap="round" opacity={opacity}
      />
    )
  }

  /** Palica (2×2 cm) kot projekciran črtasti primitiva z debelino v cm. */
  const pushBar = (a: Vec3, b: Vec3, color: string): void => {
    const pa = proj(a.x, a.y, a.z)
    const pb = proj(b.x, b.y, b.z)
    const w = Math.max(1, 2 * scale * ((pa.s + pb.s) / 2))
    prims.push({
      d: (pa.d + pb.d) / 2,
      node: (
        <line
          key={`l${seq++}`}
          x1={pa.x.toFixed(1)} y1={pa.y.toFixed(1)}
          x2={pb.x.toFixed(1)} y2={pb.y.toFixed(1)}
          stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.95}
        />
      ),
    })
  }

  /**
   * Prizma s tlorisom (xa..xb) × (za..zb); višine y so ločene pri xa in xb,
   * tako da ročnik/palice sledijo nagibu. 6 ploskev, senčenih po normali.
   */
  const pushPrism = (xa: number, xb: number, za: number, zb: number, ya0: number, ya1: number, yb0: number, yb1: number, base: string): void => {
    const A0: Vec3 = { x: xa, y: ya0, z: za }, A1: Vec3 = { x: xa, y: ya1, z: za }
    const A2: Vec3 = { x: xb, y: yb1, z: za }, A3: Vec3 = { x: xb, y: yb0, z: za }
    const B0: Vec3 = { x: xa, y: ya0, z: zb }, B1: Vec3 = { x: xa, y: ya1, z: zb }
    const B2: Vec3 = { x: xb, y: yb1, z: zb }, B3: Vec3 = { x: xb, y: yb0, z: zb }
    const faces: Vec3[][] = [
      [A0, A1, A2, A3], // spredaj
      [B0, B1, B2, B3], // zadaj
      [A1, B1, B2, A2], // zgoraj
      [A0, B0, B3, A3], // spodaj
      [A0, A1, B1, B0], // levo
      [A2, A3, B3, B2], // desno
    ]
    const ccx = (xa + xb) / 2
    const ccy = (ya0 + ya1 + yb0 + yb1) / 4
    const ccz = (za + zb) / 2
    for (const f of faces) {
      // Newellova normala, usmerjena od središča prizme navzven
      let nx = 0, ny = 0, nz = 0
      for (let i = 0; i < f.length; i++) {
        const c = f[i], n = f[(i + 1) % f.length]
        nx += (c.y - n.y) * (c.z + n.z)
        ny += (c.z - n.z) * (c.x + n.x)
        nz += (c.x - n.x) * (c.y + n.y)
      }
      const fcx = f.reduce((s, p) => s + p.x, 0) / 4
      const fcy = f.reduce((s, p) => s + p.y, 0) / 4
      const fcz = f.reduce((s, p) => s + p.z, 0) / 4
      if (nx * (fcx - ccx) + ny * (fcy - ccy) + nz * (fcz - ccz) < 0) { nx = -nx; ny = -ny; nz = -nz }
      const nl = Math.hypot(nx, ny, nz) || 1
      const rn = rotN(nx / nl, ny / nl, nz / nl)
      const b = 0.58 + 0.42 * Math.max(0, rn.x * LX + rn.y * LY + rn.z * LZ)
      pushPoly(f, shadeColor(base, b), null, 0, 1)
    }
  }

  // ── tla: ravnina + mreža 50 cm (vedno pod ograjo — pitch ≥ 5° gleda od zgoraj) ──
  const gx0 = -40, gx1 = L + 40
  below.push(
    <polygon
      key="ground"
      points={[
        proj(gx0, 0, -DZ), proj(gx1, 0, -DZ), proj(gx1, 0, DZ), proj(gx0, 0, DZ),
      ].map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}
      fill={GROUND_FILL} stroke={GROUND_STROKE} strokeWidth="1"
    />
  )
  let step = 50
  while ((gx1 - gx0) / step > 44) step *= 2
  for (let x = 0; x <= L + 0.1; x += step) {
    pushGrid({ x, y: 0, z: -DZ }, { x, y: 0, z: DZ }, GRID_COLOR, 1, 0.7)
  }
  const stepZ = DZ / Math.max(2, Math.round(DZ / 50))
  for (let z = -DZ; z <= DZ + 0.1; z += stepZ) {
    pushGrid({ x: gx0, y: 0, z }, { x: gx1, y: 0, z }, GRID_COLOR, 1, 0.7)
  }

  // ── stebri (enakomerno po dolžini, višina sledi topY) ──
  const n = Math.max(1, Math.round(inp.posts))
  const xs = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (i * L) / (n - 1)))
  for (const x of xs) {
    pushPrism(x - 3, x + 3, -3, 3, 0, topY(x), 0, topY(x), inp.colorHex)
  }

  // ── polnilo med stebri ──
  const barColor = lighten(inp.colorHex, 0.16)
  const midColor = lighten(inp.colorHex, 0.08)
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i] + 4
    const xb = xs[i + 1] - 4
    if (xb - xa < 2) continue
    const hl = inp.hover === i

    if (inp.tip === 'BALUSTRADA') {
      // steklene plošče (spredaj + zadaj, prozorno polnilo kot v 2D risbi)
      const ytA = topY(xa) - (inp.handrail ? 13 : 5)
      const ytB = topY(xb) - (inp.handrail ? 13 : 5)
      for (const z of [1.2, -1.2]) {
        pushPoly(
          [{ x: xa, y: ytA, z }, { x: xb, y: ytB, z }, { x: xb, y: 7, z }, { x: xa, y: 7, z }],
          hl ? 'rgba(217, 119, 6, 0.20)' : GLASS_FILL,
          hl ? AMBER : GLASS_STROKE,
          1,
          1
        )
      }
    } else {
      // navpične palice ~12 cm — višina prilagojena nagibu
      const len = xb - xa
      const count = Math.max(2, Math.round(len / 12))
      for (let j = 0; j < count; j++) {
        const bx = xa + (j * len) / (count - 1)
        pushBar(
          { x: bx, y: 6, z: 0 },
          { x: bx, y: topY(bx) - (inp.handrail ? 13 : 5), z: 0 },
          hl ? AMBER : barColor
        )
      }
    }

    // nevidno površino za hover na segmentu (zgoraj vsem primitivam)
    const hp = [
      proj(xa, 0, 0), proj(xb, 0, 0),
      proj(xb, topY(xb) + (inp.handrail ? 6 : 2), 0),
      proj(xa, topY(xa) + (inp.handrail ? 6 : 2), 0),
    ]
    hits.push(
      <polygon
        key={`h${i}`}
        points={hp.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}
        fill="transparent" stroke="none" className="cursor-pointer"
        onMouseEnter={() => inp.onHover(i)}
        onMouseLeave={() => inp.onHover(null)}
      >
        <title>{`Segment ${i + 1} — ${Math.round(xs[i + 1] - xs[i])} cm`}</title>
      </polygon>
    )
  }

  // ── ročnik (box po celotni dolžini, sledi nagibu) + srednja palica ──
  if (inp.handrail) {
    pushPrism(-6, L + 6, -2.5, 2.5, topY(-6) - 4.5, topY(-6), topY(L + 6) - 4.5, topY(L + 6), inp.colorHex)
    if (inp.tip !== 'BALUSTRADA') {
      const midA = topY(-4) * 0.55
      const midB = topY(L + 4) * 0.55
      pushPrism(-4, L + 4, -1.5, 1.5, midA - 1.5, midA + 1.5, midB - 1.5, midB + 1.5, midColor)
    }
  }

  prims.sort((a, b) => a.d - b.d) // slikarski algoritem: najprej oddaljene
  return { below, prims, hits }
}

// ─── komponenta Railing3D ────────────────────────────────────────────────────

export interface Railing3DProps {
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  slopeDeg: number
  colorHex: string
  tip: KonfigTip
  sku?: string | null
  /** Kompaktni predogled (projekti): manjši platno, brez avtorotacije. */
  compact?: boolean
}

export function Railing3D (props: Railing3DProps) {
  const { lengthCm, heightCm, posts, handrail, slopeDeg, colorHex, tip, sku, compact } = props
  const vh = compact ? 340 : 400
  const [yaw, setYaw] = useState(28)
  const [pitch, setPitch] = useState(22)
  const [rotating, setRotating] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  // samodejno vrtenje — requestAnimationFrame se OBVEZNO počisti ob unmount
  useEffect(() => {
    if (!rotating) return
    let raf = 0
    const step = (): void => {
      setYaw((y) => (y + 0.4 >= 75 ? -75 : y + 0.4))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [rotating])

  const scene = useMemo(
    () => buildScene({ lengthCm, heightCm, posts, handrail, slopeDeg, colorHex, tip, yaw, pitch, hover, vh, onHover: setHover }),
    [lengthCm, heightCm, posts, handrail, slopeDeg, colorHex, tip, yaw, pitch, hover, vh]
  )

  const onYaw = (v: number[]): void => {
    setRotating(false) // interakcija ustavi vrtenje
    setYaw(v[0] ?? yaw)
  }
  const onPitch = (v: number[]): void => {
    setRotating(false)
    setPitch(v[0] ?? pitch)
  }

  const dim = `${fmtM(lengthCm)} m × ${Math.round(heightCm)} cm · ${Math.max(1, Math.round(posts))} stebrov`
  const caption = `${sku ? `${sku} · ` : ''}${TIP_LABELS[tip]}`

  return (
    <div>
      <svg
        viewBox={`0 0 ${VW} ${vh}`}
        className="w-full"
        role="img"
        aria-label={`3D predogled: ${caption}, ${dim}${slopeDeg > 0 ? `, nagib ${slopeDeg.toFixed(1).replace('.', ',')}°` : ''}`}
      >
        <title>{`3D predogled — ${caption}, ${dim}`}</title>
        <rect x="0" y="0" width={VW} height={vh} rx="10" fill="#f8fafc" />
        {scene.below}
        {scene.prims.map((p) => p.node)}
        {scene.hits}
        <text x="16" y={vh - 12} fontSize="11" fill="#64748b" aria-hidden>
          {caption} · {dim}
        </text>
      </svg>

      <div className="mt-3 space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Usmerjenost (yaw)</span>
              <span className="tabular-nums text-muted-foreground">{Math.round(yaw)}°</span>
            </div>
            <Slider
              aria-label="Usmerjenost 3D pogleda"
              min={-75} max={75} step={1} value={[yaw]} onValueChange={onYaw} className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Nagib pogleda (pitch)</span>
              <span className="tabular-nums text-muted-foreground">{Math.round(pitch)}°</span>
            </div>
            <Slider
              aria-label="Nagib 3D pogleda"
              min={5} max={60} step={1} value={[pitch]} onValueChange={onPitch} className="h-11"
            />
          </div>
        </div>

        {compact ? (
          <p className="text-[11px] text-muted-foreground">Premaknite sliderja za drugačen pogled.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Hover na segmentu ga poudari.</p>
            <Button
              type="button"
              size="sm"
              variant={rotating ? 'default' : 'outline'}
              aria-pressed={rotating}
              onClick={() => setRotating((r) => !r)}
            >
              <RotateCw className={cn('size-4', rotating && 'animate-spin')} aria-hidden />
              Samodejno vrtenje
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
