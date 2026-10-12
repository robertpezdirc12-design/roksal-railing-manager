'use client'

// guide-sketches — R490 (issue #11 §2): lastne SVG skice za SMART GUIDE.
// Vzorec: nagib.tsx TriangleSvg (viewBox + role="img" + aria-label +
// aplikacijske barve stroke-roksal-amber / fill-foreground, text-[11px]).
//
// NAČELA (issue #11):
//  - Vsaka skica je SHEMATSKA in nosi vidno oznako »Shematski prikaz — ni merilo«
//    (figcaption, SL/HR) — ne predstavlja dejanske mere niti dokaza.
//  - Oster prikaz na mobilnem (čiste vektorske črte), povečljiva (SVG),
//    dostopna (aria-label iz vnosa pomoči, SL/HR alt).
//  - Izključno lastne risbe — brez tujih assetov, brez fotomontaž, brez merila.

import type { ReactNode } from 'react'
import type { GuideLang, SketchKey } from '@/lib/smart-guide-registry'

// puščica z izrisano glavo (brez SVG marker id-jev — varno večkrat na strani)
function Arrow ({ x1, y1, x2, y2, dashed = false, tone = 'base' }: {
  x1: number; y1: number; x2: number; y2: number; dashed?: boolean; tone?: 'base' | 'amber'
}) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const hx = x2 - 7 * Math.cos(a)
  const hy = y2 - 7 * Math.sin(a)
  const p1 = { x: x2, y: y2 }
  const p2 = { x: hx + 3.4 * Math.sin(a), y: hy - 3.4 * Math.cos(a) }
  const p3 = { x: hx - 3.4 * Math.sin(a), y: hy + 3.4 * Math.cos(a) }
  const cls = tone === 'amber' ? 'stroke-roksal-amber' : 'stroke-muted-foreground'
  return (
    <g>
      <line x1={x1} y1={y1} x2={hx} y2={hy} className={cls} strokeWidth={1.7} strokeDasharray={dashed ? '5 4' : undefined} />
      <polygon points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`} className={tone === 'amber' ? 'fill-roksal-amber' : 'fill-muted-foreground'} />
    </g>
  )
}

// dvosmerna puščica (razmik, mere)
function Arrow2 ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const o = 7
  return (
    <g>
      <line x1={x1 + o * Math.cos(a)} y1={y1 + o * Math.sin(a)} x2={x2 - o * Math.cos(a)} y2={y2 - o * Math.sin(a)} className="stroke-roksal-amber" strokeWidth={1.6} />
      <Arrow x1={x1 + o * Math.cos(a)} y1={y1 + o * Math.sin(a)} x2={x1} y2={y1} tone="amber" />
      <Arrow x1={x2 - o * Math.cos(a)} y1={y2 - o * Math.sin(a)} x2={x2} y2={y2} tone="amber" />
    </g>
  )
}

function Box ({ x, y, w, h, label, tone = 'base' }: { x: number; y: number; w: number; h: number; label: string; tone?: 'base' | 'amber' }) {
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h} rx={7}
        className={tone === 'amber' ? 'fill-roksal-amber/15 stroke-roksal-amber' : 'fill-secondary stroke-muted-foreground'}
        strokeWidth={1.6}
      />
      <text
        x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle"
        className={tone === 'amber' ? 'fill-roksal-amber text-[11px] font-bold' : 'fill-foreground text-[11px] font-semibold'}
      >
        {label}
      </text>
    </g>
  )
}

// steber ograje (glava + deblo) — skupni gradnik
function Post ({ x, baseY, h }: { x: number; baseY: number; h: number }) {
  return (
    <g>
      <rect x={x - 3.5} y={baseY - h} width={7} height={h} rx={1.5} className="fill-muted-foreground" />
      <rect x={x - 6.5} y={baseY - h - 5} width={13} height={5} rx={1.5} className="fill-muted-foreground" />
    </g>
  )
}

function SketchDanes () {
  return (
    <g>
      <Box x={12} y={58} w={62} h={34} label="NALOG" tone="amber" />
      <Arrow x1={76} y1={75} x2={94} y2={75} />
      <Box x={96} y={42} w={62} h={34} label="ZAJEM" />
      <Box x={96} y={78} w={62} h={34} label="MERITVE" />
      <Arrow x1={160} y1={75} x2={178} y2={75} />
      <Box x={180} y={58} w={62} h={34} label="KONTROLE" />
      <Arrow x1={244} y1={75} x2={262} y2={75} />
      <Box x={264} y={58} w={50} h={34} label="KONEC" tone="amber" />
      <text x={164} y={130} textAnchor="middle" className="fill-foreground text-[10px]">fotografije pred / med / po</text>
      <text x={164} y={145} textAnchor="middle" className="fill-muted-foreground text-[10px]">kontrolne točke → primopredaja</text>
    </g>
  )
}

function SketchZajem () {
  return (
    <g>
      {/* ograja */}
      <line x1={30} y1={64} x2={290} y2={64} className="stroke-muted-foreground" strokeWidth={3} strokeLinecap="round" />
      <Post x={40} baseY={64} h={0} />
      <Post x={85} baseY={64} h={0} />
      <Post x={130} baseY={64} h={0} />
      <Post x={175} baseY={64} h={0} />
      <Post x={220} baseY={64} h={0} />
      <Post x={265} baseY={64} h={0} />
      {/* telefon */}
      <rect x={148} y={96} width={30} height={48} rx={5} className="fill-secondary stroke-roksal-amber" strokeWidth={2.4} />
      <rect x={153} y={102} width={20} height={30} rx={2} className="fill-roksal-amber/20" />
      {/* premiki levo/desno */}
      <Arrow x1={126} y1={120} x2={142} y2={120} tone="amber" />
      <Arrow x1={200} y1={120} x2={184} y2={120} tone="amber" />
      {/* pokritost gor/dol */}
      <Arrow x1={122} y1={96} x2={112} y2={78} tone="amber" />
      <Arrow x1={204} y1={78} x2={214} y2={96} tone="amber" />
      <text x={74} y={160} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">počasno, enakomerno</text>
      <text x={240} y={160} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">pokrij vse strani</text>
    </g>
  )
}

function SketchMeritev () {
  return (
    <g>
      {/* tla */}
      <line x1={30} y1={132} x2={290} y2={132} className="stroke-muted-foreground" strokeWidth={2.5} strokeLinecap="round" />
      {/* ograja */}
      <line x1={70} y1={70} x2={250} y2={70} className="stroke-muted-foreground" strokeWidth={3.5} strokeLinecap="round" />
      <Post x={70} baseY={132} h={62} />
      <Post x={250} baseY={132} h={62} />
      {/* točki A in B */}
      <circle cx={70} cy={132} r={4.5} className="fill-roksal-amber" />
      <circle cx={250} cy={132} r={4.5} className="fill-roksal-amber" />
      <text x={57} y={151} className="fill-roksal-amber text-[12px] font-bold">A</text>
      <text x={257} y={151} className="fill-roksal-amber text-[12px] font-bold">B</text>
      {/* višina */}
      <Arrow2 x1={100} y1={70} x2={100} y2={132} />
      <text x={106} y={104} className="fill-roksal-amber text-[11px] font-semibold">višina</text>
      {/* dolžina */}
      <line x1={70} y1={112} x2={250} y2={112} className="stroke-muted-foreground" strokeWidth={1.4} strokeDasharray="5 4" />
      <text x={160} y={124} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">dolžina (tekač)</text>
      <text x={160} y={164} textAnchor="middle" className="fill-muted-foreground text-[10px]">merimo od podlage do zgornjega roba ročnika</text>
    </g>
  )
}

function SketchOgradnja () {
  return (
    <g>
      {/* tloris tekača */}
      <polyline points="60,120 140,120 140,58 262,58" className="stroke-muted-foreground" strokeWidth={2.2} fill="none" strokeDasharray="7 5" />
      {/* točke */}
      <circle cx={60} cy={120} r={5} className="fill-roksal-amber" />
      <circle cx={100} cy={120} r={4} className="fill-foreground" />
      <circle cx={140} cy={120} r={4} className="fill-foreground" />
      <circle cx={140} cy={90} r={4} className="fill-foreground" />
      <circle cx={200} cy={58} r={4} className="fill-foreground" />
      <circle cx={262} cy={58} r={5} className="fill-roksal-amber" />
      <text x={26} y={141} className="fill-roksal-amber text-[10px] font-bold">ZAČETEK</text>
      <text x={246} y={42} className="fill-roksal-amber text-[10px] font-bold">KONEC</text>
      <text x={86} y={137} className="fill-foreground text-[9px]">stebri</text>
      <text x={148} y={106} className="fill-foreground text-[9px]">vogal = steber</text>
      <text x={188} y={44} className="fill-foreground text-[9px]">segmenti</text>
      {/* VERIFIED */}
      <g transform="translate(196, 112)">
        <rect x={0} y={0} width={64} height={22} rx={11} className="fill-emerald-600/15 stroke-emerald-600" strokeWidth={1.4} />
        <text x={32} y={15} textAnchor="middle" className="fill-emerald-700 dark:fill-emerald-400 text-[10px] font-bold">VERIFIED</text>
      </g>
    </g>
  )
}

function SketchTeren () {
  return (
    <g>
      {/* stopnice */}
      <path d="M 30 132 L 80 132 L 80 108 L 130 108 L 130 84 L 190 84" className="stroke-muted-foreground" strokeWidth={2.4} fill="none" strokeLinejoin="round" />
      {/* zid */}
      <rect x={252} y={40} width={14} height={60} className="fill-muted-foreground" />
      {/* ograja po naklonu */}
      <line x1={80} y1={100} x2={190} y2={62} className="stroke-roksal-amber" strokeWidth={3} strokeLinecap="round" />
      {/* kot */}
      <path d="M 52 132 A 16 16 0 0 0 48 118" className="stroke-roksal-amber" strokeWidth={1.4} fill="none" />
      <text x={56} y={118} className="fill-roksal-amber text-[10px] font-bold">α</text>
      {/* ovira */}
      <circle cx={224} cy={92} r={7} className="fill-secondary stroke-muted-foreground" strokeWidth={1.6} />
      <text x={214} y={112} className="fill-foreground text-[10px]">ovira</text>
      <text x={26} y={148} className="fill-foreground text-[10px] font-semibold">stopnice: v in d posebej</text>
      <text x={214} y={34} className="fill-foreground text-[10px] font-semibold">zid</text>
      <text x={160} y={163} textAnchor="middle" className="fill-muted-foreground text-[10px]">ena slika ne zadostuje za visino na naklonu</text>
    </g>
  )
}

function SketchKonfigurator () {
  return (
    <g>
      {/* tla */}
      <line x1={28} y1={130} x2={292} y2={130} className="stroke-muted-foreground" strokeWidth={2.5} strokeLinecap="round" />
      {/* stebri */}
      <Post x={46} baseY={130} h={52} />
      <Post x={116} baseY={130} h={52} />
      <Post x={186} baseY={130} h={52} />
      <Post x={256} baseY={130} h={52} />
      {/* ročnik */}
      <line x1={40} y1={70} x2={262} y2={70} className="stroke-muted-foreground" strokeWidth={3.5} strokeLinecap="round" />
      {/* polnilo — lameli */}
      {[0, 1, 2].map((i) => {
        const x0 = 52 + i * 70
        return [0, 1, 2, 3, 4, 5].map((j) => (
          <line key={`${i}-${j}`} x1={x0 + j * 11} y1={82} x2={x0 + j * 11} y2={126} className="stroke-muted-foreground/70" strokeWidth={2} strokeLinecap="round" />
        ))
      })}
      {/* vrata */}
      <path d="M 262 82 L 262 126" className="stroke-roksal-amber" strokeWidth={1.6} strokeDasharray="4 3" />
      <text x={290} y={108} textAnchor="end" className="fill-roksal-amber text-[10px] font-bold">vrata</text>
      {/* razmik */}
      <Arrow2 x1={46} y1={146} x2={116} y2={146} />
      <text x={81} y={162} textAnchor="middle" className="fill-roksal-amber text-[10px] font-semibold">razmik stebrov</text>
    </g>
  )
}

function SketchBom () {
  return (
    <g>
      <Box x={16} y={62} w={76} h={34} label="IZMERA" tone="amber" />
      <Arrow x1={94} y1={79} x2={116} y2={79} />
      <Box x={118} y={62} w={80} h={34} label="KOSOVNICA" />
      <Arrow x1={200} y1={79} x2={222} y2={79} />
      <Box x={224} y={62} w={80} h={34} label="PONUDBA" tone="amber" />
      {/* verzije */}
      <rect x={132} y={112} width={56} height={20} rx={10} className="fill-secondary stroke-muted-foreground" strokeWidth={1.2} />
      <text x={160} y={126} textAnchor="middle" className="fill-foreground text-[9px] font-semibold">verzije</text>
      <line x1={158} y1={96} x2={160} y2={112} className="stroke-muted-foreground" strokeWidth={1.2} />
      <text x={160} y={152} textAnchor="middle" className="fill-muted-foreground text-[10px]">nepotrjene vrednosti so vidno označene</text>
    </g>
  )
}

function SketchNalog () {
  const frames = [
    { x: 22, label: 'PRED', icon: 'M 38 72 l 10 12 l 16 -20' },
    { x: 126, label: 'MED', icon: 'M 148 52 l 0 16 l 12 0 M 154 52 a 12 12 0 1 0 0.1 0' },
    { x: 230, label: 'PO', icon: 'M 246 72 l 8 10 l 16 -20' }
  ]
  return (
    <g>
      {frames.map(({ x, label, icon }) => (
        <g key={label}>
          <rect x={x} y={38} width={68} height={50} rx={6} className="fill-secondary stroke-muted-foreground" strokeWidth={1.6} />
          <path d={icon} className="stroke-roksal-amber" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x={x + 34} y={104} textAnchor="middle" className="fill-foreground text-[11px] font-bold">{label}</text>
        </g>
      ))}
      <Arrow x1={92} y1={63} x2={124} y2={63} />
      <Arrow x1={196} y1={63} x2={228} y2={63} />
      {/* kontrolni seznam */}
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${110 + i * 22}, 118)`}>
          <rect x={0} y={0} width={14} height={14} rx={3} className="fill-secondary stroke-muted-foreground" strokeWidth={1.4} />
          {i < 2 ? <path d="M 3.5 7.5 l 2.5 3 l 4.5 -6" className="stroke-roksal-amber" strokeWidth={1.8} fill="none" strokeLinecap="round" /> : null}
        </g>
      ))}
      <text x={160} y={145} textAnchor="middle" className="fill-muted-foreground text-[10px]">kontrolne točke → status + razlog</text>
      <text x={160} y={161} textAnchor="middle" className="fill-muted-foreground text-[10px]">zaključek blokira odprta kritična napaka</text>
    </g>
  )
}

function SketchProjekt () {
  return (
    <g>
      <Box x={8} y={62} w={50} h={30} label="lead" />
      <Arrow x1={60} y1={77} x2={76} y2={77} />
      <Box x={78} y={62} w={56} h={30} label="ponudba" />
      <Arrow x1={136} y1={77} x2={152} y2={77} />
      <Box x={154} y={62} w={52} h={30} label="projekt" tone="amber" />
      <Arrow x1={208} y1={77} x2={224} y2={77} />
      <Box x={226} y={62} w={42} h={30} label="nalog" />
      <Arrow x1={270} y1={77} x2={286} y2={77} />
      <Box x={288} y={62} w={24} h={30} label="✓" tone="amber" />
      {/* revizijska sled */}
      <line x1={40} y1={118} x2={280} y2={118} className="stroke-muted-foreground" strokeWidth={1.2} strokeDasharray="3 4" />
      <circle cx={100} cy={118} r={3} className="fill-muted-foreground" />
      <circle cx={180} cy={118} r={3} className="fill-muted-foreground" />
      <circle cx={250} cy={118} r={3} className="fill-muted-foreground" />
      <text x={160} y={136} textAnchor="middle" className="fill-muted-foreground text-[10px]">vsaka sprememba → revizijski dnevnik</text>
    </g>
  )
}

function SketchStopnica () {
  const A = { x: 60, y: 128 }
  const B = { x: 240, y: 128 }
  const C = { x: 60, y: 58 }
  return (
    <g>
      {/* stopnice */}
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M ${60 + i * 45} 128 L ${60 + i * 45} ${128 - (i + 1) * 17.5} L ${60 + (i + 1) * 45} ${128 - (i + 1) * 17.5}`} className="stroke-muted-foreground" strokeWidth={2} fill="none" />
      ))}
      {/* kateti */}
      <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="stroke-muted-foreground" strokeWidth={2.2} />
      <line x1={A.x} y1={A.y} x2={C.x} y2={C.y} className="stroke-muted-foreground" strokeWidth={2.2} />
      {/* ograja po hipotenuzi */}
      <line x1={C.x} y1={C.y} x2={B.x} y2={B.y} className="stroke-roksal-amber" strokeWidth={3.4} strokeLinecap="round" />
      {/* kot α */}
      <path d="M 240 116 A 12 12 0 0 0 231.5 119.5" className="stroke-roksal-amber" strokeWidth={1.5} fill="none" />
      <text x={228} y={112} className="fill-roksal-amber text-[11px] font-bold">α</text>
      {/* mere */}
      <text x={38} y={95} textAnchor="end" className="fill-foreground text-[11px] font-semibold">v</text>
      <text x={150} y={146} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">d</text>
      <text x={176} y={76} textAnchor="middle" className="fill-roksal-amber text-[11px] font-bold">ograja</text>
    </g>
  )
}

function SketchFoto () {
  return (
    <g>
      {/* kamera */}
      <rect x={36} y={58} width={58} height={40} rx={7} className="fill-secondary stroke-muted-foreground" strokeWidth={2} />
      <circle cx={65} cy={78} r={12} className="fill-roksal-amber/25 stroke-roksal-amber" strokeWidth={2.2} />
      <rect x={46} y={50} width={16} height={10} rx={3} className="fill-secondary stroke-muted-foreground" strokeWidth={1.6} />
      {/* sonce */}
      <circle cx={230} cy={34} r={9} className="fill-roksal-amber" />
      <line x1={230} y1={18} x2={230} y2={24} className="stroke-roksal-amber" strokeWidth={1.8} />
      <line x1={246} y1={34} x2={252} y2={34} className="stroke-roksal-amber" strokeWidth={1.8} />
      {/* ograja */}
      <line x1={150} y1={96} x2={292} y2={96} className="stroke-muted-foreground" strokeWidth={3} strokeLinecap="round" />
      <Post x={158} baseY={96} h={0} />
      <Post x={190} baseY={96} h={0} />
      <Post x={222} baseY={96} h={0} />
      <Post x={254} baseY={96} h={0} />
      <Post x={286} baseY={96} h={0} />
      {/* smer zajema */}
      <path d="M 100 60 L 158 88" className="stroke-roksal-amber/70" strokeWidth={1.4} strokeDasharray="4 4" />
      <text x={160} y={126} textAnchor="middle" className="fill-muted-foreground text-[10px]">dnevna svetloba, cel objekt v okvirju</text>
      <text x={160} y={152} textAnchor="middle" className="fill-muted-foreground text-[10px]">javna objava → veljavno soglasje stranke</text>
    </g>
  )
}

const SKETCHES: Record<SketchKey, () => ReactNode> = {
  danes: SketchDanes,
  zajem: SketchZajem,
  meritev: SketchMeritev,
  ogradnja: SketchOgradnja,
  teren: SketchTeren,
  konfigurator: SketchKonfigurator,
  bom: SketchBom,
  nalog: SketchNalog,
  projekt: SketchProjekt,
  stopnica: SketchStopnica,
  foto: SketchFoto
}

/** Vsi veljavni ključi skic, ki imajo dejansko komponento (izvozi testom/servisu). */
export const SKETCH_COMPONENT_KEYS: SketchKey[] = Object.keys(SKETCHES) as SketchKey[]

/**
 * Skica vstopa pomoči — enoten okvir z obvezno oznako »Shematski prikaz — ni merilo«.
 * alt je dvojezični opis iz vnosa pomoči (bralniki zaslona); lang določa jezik
 * napisa pod skico (SL/HR).
 */
export function GuideSketch ({ k, alt, lang }: { k: SketchKey; alt: string; lang: GuideLang }) {
  const Sketch = SKETCHES[k]
  if (!Sketch) return null
  return (
    <figure className="rounded-lg border bg-card p-3">
      <svg viewBox="0 0 320 170" className="h-auto w-full" role="img" aria-label={alt}>
        <Sketch />
      </svg>
      <figcaption className="mt-2 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {lang === 'sl' ? 'Shematski prikaz — ni merilo' : 'Shematski prikaz — nije mjerilo'}
      </figcaption>
    </figure>
  )
}
