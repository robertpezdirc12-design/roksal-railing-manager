// photo-replace-engine — R459 (issue #14) strežniško jedro
// Skupna logika API rut foto-vizualizacij: obseg dostopa (§13 IDOR), validacija
// vhoda (fotografija/quad/referenca/konfiguracija/povezave), verzioniranje (§12).
// NE odvisna od 'use client' — uporabljena izključno v API rutah.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, type SessionUser } from '@/lib/auth'
import {
  ENGINE_VERSION, preveriConfig, preveriQuad,
  type RenderParams, type VizReference,
} from '@/lib/photo-replace-core'
import { jePraznaMaska, preveriMasko } from '@/lib/photo-replace-mask'
import {
  normalizirajTrdnjo, potrdiGradivo, smeVizualizacijo,
  type GradivoIzBaze, type RezultatGradiva,
} from '@/lib/viz-provenance'

// ─── Omejitve vhoda ──────────────────────────────────────────────────────────

export const MAX_PHOTO_BYTES = 4_500_000 // ~4,5 MB data URL niza
export const MAX_RENDERED_BYTES = 2_500_000 // ~2,5 MB data URL niza
export const MAX_PARAMS_JSON = 12_000 // renderParams JSON ≤ 12 KB
export const VARIANT_LABELS = ['A', 'B', 'C'] as const
export const STATUSES = ['OSNUTEK', 'IZBRANA', 'ARHIV'] as const

export type VariantLabel = (typeof VARIANT_LABELS)[number]

/** Preveri data URL (JPEG) in velikost. */
export function preveriFoto (v: unknown, max: number, polje: string): { napaka: string } | { dataUrl: string } {
  if (typeof v !== 'string' || !v.startsWith('data:image/jpeg;base64,')) {
    return { napaka: `${polje}: zahtevana je slika JPEG (data URL).` }
  }
  if (v.length > max) {
    return { napaka: `${polje}: slika presega ${Math.round(max / 1000)} kB — zmanjšajte ločljivost.` }
  }
  if (v.length < 200) {
    return { napaka: `${polje}: slika je sumljivo majhna.` }
  }
  return { dataUrl: v }
}

/** Validira celoten renderParams → bodisi napaka (400) bodisi očiščen objekt. */
export function preveriRenderParams (v: unknown): { napaka: string } | { params: RenderParams; opozorila: { koda: string; sporocilo: string }[] } {
  if (typeof v !== 'object' || v === null) return { napaka: 'Manjkajo parametri izrisa (quad, referenca, konfiguracija).' }
  const o = v as Record<string, unknown>
  const q = preveriQuad(o.quad)
  if (!q.quad) return { napaka: q.napake[0]?.sporocilo ?? 'Neveljavno območje ograje.' }
  // referenca
  const r = o.reference
  if (typeof r !== 'object' || r === null) return { napaka: 'Manjka referenčna mera (merilo slike).' }
  const rr = r as Record<string, unknown>
  const refCm = rr.cm
  if (typeof refCm !== 'number' || !Number.isFinite(refCm) || refCm < 20 || refCm > 20000) {
    return { napaka: 'Referenčna mera mora biti med 20 in 20000 cm.' }
  }
  const reference: VizReference = {
    tip: rr.tip === 'MERITEV' ? 'MERITEV' : 'ROCNO',
    cm: refCm,
    ...(typeof rr.opis === 'string' && rr.opis.trim() ? { opis: rr.opis.trim().slice(0, 200) } : {}),
  }
  const c = preveriConfig(o.config)
  if (!c.config) return { napaka: c.napake[0]?.sporocilo ?? 'Neveljavna konfiguracija.' }
  // R507 (issue #14 §1): ročna maska je NEOBVEZNA — brez nje ima renderParams
  // enako obliko kot doslej, zato obstoječe vizualizacije ostanejo veljavne.
  const mk = preveriMasko(o.maska)
  if (mk.napake.length > 0) return { napaka: mk.napake[0].sporocilo }
  const maska = jePraznaMaska(mk.maska) ? null : mk.maska
  return {
    params: maska ? { quad: q.quad, reference, config: c.config, maska } : { quad: q.quad, reference, config: c.config },
    opozorila: [],
  }
}

// ─── Obseg dostopa (§13: brez IDOR do fotografij drugih strank/projektov) ────

/**
 * Monter (brez readsAllData) vidi SAMO projekte svojih nalogov ALI svoje
 * vizualizacije (avtor); pisarna (ADMIN/VODJA/SKLADIŠČE/PROIZVODNJA) vidi vse.
 */
export async function projektZaUporabnika (
  user: SessionUser,
  projectId: string
): Promise<{ id: string; code: string; title: string } | NextResponse> {
  const projekt = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, title: true, workOrders: { select: { assigneeId: true } } },
  })
  if (!projekt) return jsonError(404, 'Projekt ne obstaja.')
  const role = user.role
  const bereVse = ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(role)
  if (!bereVse) {
    const dodeljen = projekt.workOrders.some((w) => w.assigneeId === user.id)
    if (!dodeljen) {
      return jsonError(403, 'Projekt ni na voljo vašim nalogom.', 'Monter vidi samo projekte svojih delovnih nalogov.')
    }
  }
  return { id: projekt.id, code: projekt.code, title: projekt.title }
}

/** Alias za readsAllData brez uvoza zanke (auth uvaža db, tu le vloga). */
export function bereVseProjekte (user: { role: string }): boolean {
  return ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)
}

/** Vizualizacija + obseg dostopa (lastnik = avtor ali nalog projekta). */
export async function vizZaUporabnika (
  user: SessionUser,
  id: string
): Promise<{ viz: {
  id: string; projectId: string; variantLabel: string; status: string
  authorId: string | null; engineVersion: string; renderParams: string
  measurementId: string | null; measurementVersion: number | null
  sourcePhotoId: string | null
  productId: string; variantId: string | null
} } | NextResponse> {
  const viz = await db.photoVisualization.findUnique({ where: { id } })
  if (!viz) return jsonError(404, 'Vizualizacija ne obstaja.')
  if (!bereVseProjekte(user) && viz.authorId !== user.id) {
    const wo = await db.workOrder.findFirst({ where: { projectId: viz.projectId, assigneeId: user.id }, select: { id: true } })
    if (!wo) {
      return jsonError(403, 'Vizualizacija ni na voljo.', 'Nimate dostopa do projektov te stranke.')
    }
  }
  return { viz: viz as unknown as {
    id: string; projectId: string; variantLabel: string; status: string
    authorId: string | null; engineVersion: string; renderParams: string
    measurementId: string | null; measurementVersion: number | null
    sourcePhotoId: string | null
    productId: string; variantId: string | null
  } }
}

// ─── Povezave (§12: EKSPlicitni ID — nikoli fuzzy matching) ──────────────────

/** Preveri izdelek (+ optional varianto pripadajočo izdelku). */
export async function preveriIzdelek (
  productId: unknown,
  variantId: unknown
): Promise<{ produkt: { id: string; sku: string; name: string; unit: string; tech: string | null; familyCode: string } } | { napaka: string; status: number }> {
  if (typeof productId !== 'string' || !productId) return { napaka: 'Manjka izdelek (productId).', status: 400 }
  const p = await db.product.findUnique({
    where: { id: productId },
    include: { family: { select: { code: true } } },
  })
  if (!p || !p.active) return { napaka: 'Izdelek ne obstaja ali ni aktiven.', status: 404 }
  if (variantId != null) {
    if (typeof variantId !== 'string' || !variantId) return { napaka: 'Neveljavna varianta.', status: 400 }
    const v = await db.productVariant.findUnique({ where: { id: variantId } })
    if (!v || v.productId !== p.id) return { napaka: 'Varianta ne pripada izdelku.', status: 400 }
  }
  return {
    produkt: {
      id: p.id, sku: p.sku, name: p.name, unit: p.unit,
      tech: p.tech, familyCode: p.family.code,
    },
  }
}

/**
 * R510 (Faza 6): TRENUTNO stanje povezane mere — raven, zadnja verzija in
 * dolžina. Povezava že obstaja v bazi, tu se samo prebere; meritev, ki je več
 * ni, vrne `NEPOZNANO` in ne izmišljene ravni. Skupno za GET in PATCH, da
 * dokazne verige ne more brati drugače kot urejevalnik.
 */
export async function stanjeMere (
  measurementId: string | null
): Promise<{ status: string; verzija: number | null; lengthCm: number | null } | null> {
  if (!measurementId) return null
  const m = await db.measurement.findUnique({
    where: { id: measurementId },
    select: {
      status: true, lengthCm: true,
      versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
    },
  })
  if (!m) return { status: 'NEPOZNANO', verzija: null, lengthCm: null }
  return { status: m.status ?? 'NEPOZNANO', verzija: m.versions[0]?.version ?? null, lengthCm: m.lengthCm }
}

/**
 * Preveri meritev (pripada projektu) + vrne zadnjo verzijo (snapshot §12) in
 * RAVEN mere (R510, Faza 6): vizualizacija mora v dokumentu pokazati, na kateri
 * meri in kateri njeni ravni stoji. Razveljavljene mere (INVALIDATED — pisarna
 * jo je umaknila PO uporabi) ne smejo biti podlaga nove vizualizacije; ostale
 * ravni so dovoljene, ker je vizualizacija predstavitev, ne proizvodni izračun.
 */
export async function preveriMeritev (
  measurementId: unknown,
  projectId: string
): Promise<{ meritev: { id: string; lengthCm: number | null; heightCm: number | null; posts: number | null; status: string | null }; verzija: number } | { napaka: string; status: number }> {
  if (typeof measurementId !== 'string' || !measurementId) return { napaka: 'Neveljaven measurementId.', status: 400 }
  const m = await db.measurement.findUnique({
    where: { id: measurementId },
    select: {
      id: true, projectId: true, lengthCm: true, heightCm: true, posts: true, status: true,
      versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
    },
  })
  if (!m) return { napaka: 'Meritev ne obstaja.', status: 404 }
  if (m.projectId !== projectId) return { napaka: 'Meritev ne pripada temu projektu.', status: 400 }
  const odlok = smeVizualizacijo(m.status)
  if (!odlok.sme) return { napaka: odlok.razlog ?? 'Meritev ni uporabna za vizualizacijo.', status: 409 }
  return {
    meritev: { id: m.id, lengthCm: m.lengthCm, heightCm: m.heightCm, posts: m.posts, status: m.status },
    verzija: m.versions[0]?.version ?? 1,
  }
}

/**
 * R510 (Faza 6): strežniška POTRDITEV trditve odjemalca o uporabljenem ROKSALOVU
 * gradivu. Odjemalec sme navesti SAMO assetId — pot in SHA-256 preberemo iz
 * baze, da trditev ne more podtiskati tujega identifikatorja. Nepotrdljive
 * trditve POTEK ne zavrne (ustvarjanja vizualizacije ne blokiramo), ampak v
 * dokument zapišejo razlog: bralec tako vidi, da dokaza NI, in ne da bi se
 * zapis dokaza izgubil.
 */
export async function preveriTrdnjenoGradivo (
  bodyTrdnja: unknown,
  productId: string | null
): Promise<{ napaka: string } | { rezultat: RezultatGradiva }> {
  const n = normalizirajTrdnjo(bodyTrdnja)
  if ('napaka' in n) return { napaka: n.napaka }
  if (n.trdnja === null) return { rezultat: { dokaz: null, razlog: null } }
  const vrstica = await db.productAsset.findUnique({
    where: { id: n.trdnja.assetId },
    select: { id: true, productId: true, kind: true, status: true, permission: true, filePath: true, sha256: true },
  })
  return { rezultat: potrdiGradivo(n.trdnja, vrstica as GradivoIzBaze | null, productId) }
}

/** Preveri sourcePhotoId (meritev tip FOTO istega projekta — sledljivost §13). */
export async function preveriSourceFoto (
  sourcePhotoId: unknown,
  projectId: string
): Promise<string | null | { napaka: string; status: number }> {
  if (sourcePhotoId == null) return null
  if (typeof sourcePhotoId !== 'string' || !sourcePhotoId) return { napaka: 'Neveljaven sourcePhotoId.', status: 400 }
  const m = await db.measurement.findUnique({ where: { id: sourcePhotoId } })
  if (!m) return { napaka: 'Izvorna fotografija (meritev FOTO) ne obstaja.', status: 404 }
  if (m.type !== 'FOTO') return { napaka: 'sourcePhotoId mora kazati na meritev tipa FOTO.', status: 400 }
  if (m.projectId !== projectId) return { napaka: 'Izvorna fotografija ne pripada temu projektu.', status: 400 }
  return m.id
}

/** Naslednja prosta oznaka variante na projektu (A → B → C). */
export async function naslednjaOznaka (projectId: string): Promise<VariantLabel | null> {
  const existing = await db.photoVisualization.findMany({
    where: { projectId },
    select: { variantLabel: true },
  })
  const zasedene = new Set(existing.map((v) => v.variantLabel))
  for (const l of VARIANT_LABELS) {
    if (!zasedene.has(l)) return l
  }
  return null
}

export { ENGINE_VERSION }
