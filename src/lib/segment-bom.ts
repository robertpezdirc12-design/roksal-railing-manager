// segment-bom — R475 (issue #9 §5 HOVER PARITY — KOLIČINE IZ SEGMENTOV)
// Segmentna matematika za kosovnice: količine PO ODSEKU (stebri/ročnik/
// polnilo) + pravila odpada iz EngineeringRule + skupine pozicij.
//
// NAČELO POŠTENOSTI (iz #8/#9): izpeljava ne izmišljuje podatkov.
//  • Stebri: razmik iz VNOSUpodatka uporabnika (razmikStebrovM) ali pravila
//    max_razdalja_stebrov; brez obojega se vmesni stebri NE izračunajo
//    (opozorilo BREZ_RAZMIKA — štejejo se samo čelni).
//  • Odpad: IZKLJUČNO iz pravila odpad_rez_pct; manjka → 0 % + opozorilo
//    BREZ_ODPADA (prazna rezerva je vidna, ne tiha).
//  • POLNILO_M2 brez višine segmenta → vrstica se IZPUSTE + opozorilo
//    BREZ_VISINE (ne izmišljujemo si višine).
//
// KONVENCIJA VERIGE: segmenti so 1-D veriga (kot ograjni tekač). Končni
// stebri sosednjih segmentov so FIZIČNO isti steber — lastnik je PREJŠNJI
// segment (seg-1 ima tudi prvega). Skupno št. stebrov verige =
// Σ(vmesni) + N + 1 — brez podvajanja na spojih.
//
// Ključi segmentov `seg-N` so USKLAJENI z digitalnim dvojčkom, prefab
// lističi in merilnim modelom (R473) — vrstica BOM ← segment je sledljiva.
//
// ČIST lib: NIČ strežniških uvozov — uporaben na odjemalcu in strežniku.

// ─── Verzija ────────────────────────────────────────────────────────────────

export const SEGMENT_BOM_VERSION = 'segment-bom/1.0'

// ─── Vloge komponent (ProductComponent.segmentRole) ─────────────────────────

export const SEGMENT_ROLES = ['STEBER', 'ROCNIK', 'POLNILO_M', 'POLNILO_M2'] as const
export type SegmentRole = (typeof SEGMENT_ROLES)[number]

export const SEGMENT_ROLE_LABELS: Record<SegmentRole, string> = {
  STEBER: 'Stebri — kos/steber',
  ROCNIK: 'Ročnik — m na m segmenta',
  POLNILO_M: 'Polnilo (dolžina) — m na m segmenta',
  POLNILO_M2: 'Polnilo (ploščina) — m² na m² polnila',
}

/** Skupine pozicij v kosovnici (BomLine.group) — vrstni red prikaza. */
export const SEGMENT_GROUPS = ['STEBRI', 'ROCNIK', 'POLNILO', 'OSTALO'] as const
export type SegmentGroup = (typeof SEGMENT_GROUPS)[number]

export const SEGMENT_GROUP_LABELS: Record<SegmentGroup, string> = {
  STEBRI: 'Stebri in sidranje',
  ROCNIK: 'Ročnik in profili',
  POLNILO: 'Polnilo',
  OSTALO: 'Pripadnosti in obdelava',
}

/** Vloga → skupina pozicij kosovnice. */
export const ROLE_TO_GROUP: Record<SegmentRole, SegmentGroup> = {
  STEBER: 'STEBRI',
  ROCNIK: 'ROCNIK',
  POLNILO_M: 'POLNILO',
  POLNILO_M2: 'POLNILO',
}

// ─── Ključi inženirskih pravil ───────────────────────────────────────────────

/** Razmik stebrov (cm) — EN 1990 togost ( obstoječe pravilo iz R437). */
export const POSTS_RULE_KEY = 'max_razdalja_stebrov'
/** Odpad pri rezanju profilov/polnil (%) — R475 novo pravilo. */
export const WASTE_RULE_KEY = 'odpad_rez_pct'

// ─── Vrste ──────────────────────────────────────────────────────────────────

/** Segment na vhodu segmentne matematike (iz calcJson.inputs ali tekača). */
export interface SegmentInput {
  key: string // 'seg-1' …
  lengthCm: number // dolžina po padini (3D, isti vir kot tekač)
  heightCm?: number | null // višina polnila (cm) — potrebna za POLNILO_M2
}

/** Razrešena pravila za segmentno matematiko (vir: vnosi + EngineeringRule). */
export interface SegmentRules {
  /** razmik stebrov v cm (vnos uporabnika IMEL prednost pred pravilom) */
  spacingCm: number | null
  /** vir razmika: 'vnos:razmik' | 'RULE:max_razdalja_stebrov' | null */
  spacingSource: string | null
  /** odpad rezanja v % (0 če pravilo manjka — vidno v opozorilih) */
  wastePct: number
  /** vir odpada: 'RULE:odpad_rez_pct' | null (null = brez pravila) */
  wasteSource: string | null
}

/** Opozorilo izpeljave (vidno v UI + zapisano v kalkulacijo). */
export interface SegmentWarning {
  code: 'BREZ_RAZMIKA' | 'BREZ_ODPADA' | 'BREZ_VISINE' | 'BREZ_SEGMENTOV' | 'NEZNANA_VLOGA'
  message: string
}

// ─── Izračuni ───────────────────────────────────────────────────────────────

/** Vmesni stebri znotraj segmenta — ISTA formula kot fence-run engine. */
export function intermediatePosts (lengthCm: number, maxSpanCm: number): number {
  return Math.max(1, Math.ceil(lengthCm / maxSpanCm)) - 1
}

/**
 * Stebri enega segmenta (veriga): vmesni + 1 končni; prvi segment verige
 * dobi še začetnega (lastništvo spojev glej zgornjo konvencijo).
 */
export function segmentPosts (
  lengthCm: number,
  maxSpanCm: number,
  isFirstOfChain: boolean,
): { posts: number; intermediate: number; terminals: number } {
  const intermediate = intermediatePosts(lengthCm, maxSpanCm)
  const terminals = 1 + (isFirstOfChain ? 1 : 0)
  return { posts: intermediate + terminals, intermediate, terminals }
}

/** Količina z odpadom, zaokrožena NAVZGOR na cel cm (0,01 m / m²). */
export function withWaste (qty: number, wastePct: number): number {
  const padded = qty * (1 + Math.max(0, wastePct) / 100)
  return Math.ceil(padded * 100) / 100
}

/** Dolžina segmenta v m, zaokrožena na cm. */
export function cmToM (cm: number): number {
  return Math.round(cm) / 100
}

// ─── Segmentne vrstice (jedro) ───────────────────────────────────────────────

/** Ena izpeljana vrstica za (komponenta × segment). */
export interface SegmentLine {
  segmentKey: string
  group: SegmentGroup
  role: SegmentRole
  /** količina vrstice v enoti artikla (kos/m/m²) */
  qty: number
  wastePct: number | null // null za STEBER (ne režemo na dolžino po številu)
  sourceRule: string
  note: string
}

/**
 * Izračuna vrstice ENE komponente za VSE segmente verige.
 *
 * @param role     vloga komponente (ProductComponent.segmentRole)
 * @param qtyPerRoleUnit množitelj (ProductComponent.qty) — kos/steber oz. m/m oz. m²/m²
 * @param segments  segmenti verige (dolžine po padini)
 * @param rules     razrešena pravila (razmik/odpad)
 * @returns vrstice po segmentu + opozorila (globalna za komponento)
 */
export function segmentLinesForComponent (
  role: SegmentRole,
  qtyPerRoleUnit: number,
  segments: SegmentInput[],
  rules: SegmentRules,
): { lines: SegmentLine[]; warnings: SegmentWarning[] } {
  const warnings: SegmentWarning[] = []
  const lines: SegmentLine[] = []
  const mult = Number.isFinite(qtyPerRoleUnit) && qtyPerRoleUnit > 0 ? qtyPerRoleUnit : 1
  const wasteSrc = rules.wasteSource != null ? rules.wastePct : 0
  const hasWasteRule = rules.wasteSource != null

  if (role === 'STEBER') {
    if (rules.spacingCm == null) {
      warnings.push({
        code: 'BREZ_RAZMIKA',
        message: 'Razmik stebrov ni znan (ni vnosa niti pravila max_razdalja_stebrov) — vmesni stebri niso izračunani, štejejo se samo čelni.',
      })
    }
    for (const [i, s] of segments.entries()) {
      const { posts, intermediate, terminals } = rules.spacingCm != null
        ? segmentPosts(s.lengthCm, rules.spacingCm, i === 0)
        : { posts: terminals1(i), intermediate: 0, terminals: terminals1(i) }
      const qty = Math.max(1, Math.round(mult * posts * 100) / 100)
      lines.push({
        segmentKey: s.key,
        group: 'STEBRI',
        role,
        qty,
        wastePct: null,
        sourceRule: rules.spacingSource ?? 'BREZ_PRAVILA',
        note: `vmesni ${intermediate} + čelni ${terminals}${i === 0 ? ' (prvi segment: + začetni)' : ''}`,
      })
    }
    return { lines, warnings }
  }

  if (!hasWasteRule) {
    warnings.push({
      code: 'BREZ_ODPADA',
      message: `Pravilo ${WASTE_RULE_KEY} ni nastavljeno — ${role === 'POLNILO_M2' ? 'ploščine' : 'dolžine'} so brez rezerve za odpad rezanja.`,
    })
  }

  for (const s of segments) {
    const lenM = cmToM(s.lengthCm)
    if (role === 'ROCNIK' || role === 'POLNILO_M') {
      lines.push({
        segmentKey: s.key,
        group: role === 'ROCNIK' ? 'ROCNIK' : 'POLNILO',
        role,
        qty: withWaste(mult * lenM, wasteSrc),
        wastePct: hasWasteRule ? rules.wastePct : null,
        sourceRule: rules.wasteSource ?? 'BREZ_PRAVILA',
        note: `${lenM.toFixed(2).replace('.', ',')} m ${role === 'ROCNIK' ? 'ročnika/profila' : 'polnila'}${hasWasteRule && rules.wastePct > 0 ? ` + ${rules.wastePct} % odpad` : ''}`,
      })
    } else if (role === 'POLNILO_M2') {
      if (s.heightCm == null || !(s.heightCm > 0)) {
        warnings.push({
          code: 'BREZ_VISINE',
          message: `Segment ${s.key} nima višine polnila — vrstica ploščinskega polnila je izpuščena.`,
        })
        continue
      }
      const areaM2 = Math.round(lenM * cmToM(s.heightCm) * 100) / 100
      lines.push({
        segmentKey: s.key,
        group: 'POLNILO',
        role,
        qty: withWaste(mult * areaM2, wasteSrc),
        wastePct: hasWasteRule ? rules.wastePct : null,
        sourceRule: rules.wasteSource ?? 'BREZ_PRAVILA',
        note: `${lenM.toFixed(2).replace('.', ',')} × ${cmToM(s.heightCm).toFixed(2).replace('.', ',')} m${hasWasteRule && rules.wastePct > 0 ? ` + ${rules.wastePct} % odpad` : ''}`,
      })
    }
  }
  return { lines, warnings }
}

/** Terminali ob neznanem razmiku (veriga: 1 na segment, prvi +1). */
function terminals1 (index: number): number {
  return 1 + (index === 0 ? 1 : 0)
}

// ─── Normalizacija segmentov iz calcJson.inputs ─────────────────────────────

/** Vrstica segmenta iz konfiguratorja (m-forma): {kljuc?, dolzina, visina}. */
export interface RawSegmentRow {
  kljuc?: string | null
  dolzina: number // v m
  visina?: number | null // v m
}

/**
 * Normalizira vhodne segmente iz calcJson.inputs.segments (m-forma) v
 * SegmentInput (cm). Manjkajoči ključi se POŠTENO dodelijo po vrstnem redu
 * (seg-1 … seg-N) — ključi so vezava za sledljivost vrstic BOM.
 */
export function normalizeSegments (rows: RawSegmentRow[]): SegmentInput[] {
  const out: SegmentInput[] = []
  let n = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const lenCm = Number(r?.dolzina)
    if (!Number.isFinite(lenCm) || lenCm <= 0) continue
    n++
    const h = Number(r?.visina)
    out.push({
      key: typeof r.kljuc === 'string' && r.kljuc.trim() ? r.kljuc.trim() : `seg-${n}`,
      lengthCm: Math.round(lenCm * 100),
      heightCm: Number.isFinite(h) && h > 0 ? Math.round(h * 100) : null,
    })
  }
  return out
}
