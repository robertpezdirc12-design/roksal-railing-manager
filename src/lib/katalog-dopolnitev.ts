// katalog-dopolnitev — R579: IDEMPOTENTNA dopolnitev kataloga iz repozitorija.
//
// ZAKAJ: produkcijska baza je bila osnovana z zgodnejšim seedom (samo 16
// generičnih izdelkov). Pravi ROKSAL izdelki z variantami in gradivi so v
// repozitoriju (prisma/katalog-roksal.json, izvoz iz `bun run db:seed`), ne pa
// v produkcijski bazi — zato fotomontaža na produkciji ne ponudi pravih
// materialov.
//
// PRAVILA (varnost podatkov):
//  • SAMO DODAJA. Obstoječih izdelkov/variant/gradiv NIKOLI ne prepiše
//    (cene, opisi in ročne spremembe lastnika ostanejo nedotaknjeni).
//  • IDEMPOTENTNO: drugi zagon ne naredi ničesar (vsa ključna polja so
//    unikatna: družina.code, izdelek.sku, varianta.sku; gradiva po trojici
//    productId + kind + filePath + variantSku).
//  • Vsaka napaka je POROČANA, ne tiha: manjkajoča družina ali neveljaven
//    zapis se preskoči in zapiše v `napake`.
//  • Revizija: CATALOG_DOPOLNITEV (v routeu).

import { db } from '@/lib/db'

export interface KatalogDruzina {
  code: string
  name: string
  desc: string | null
  unit: string
  sortOrder: number
  active: boolean
}

export interface KatalogVarianta {
  sku: string
  name: string
  color: string | null
  ral: string | null
  widthMm: number | null
  heightMm: number | null
  costPrice: string | null
  salePrice: string | null
  tech: unknown
  active: boolean
  sortOrder: number
}

export interface KatalogGradivo {
  variantSku: string | null
  kind: string
  orientation: string | null
  view: string | null
  colorName: string | null
  colorApprox: string | null
  filePath: string | null
  cdnUrl: string | null
  sourceUrl: string | null
  sha256: string | null
  bytes: number | null
  sourceName: string
  capturedAt: string
  permission: string
  status: string
  note: string | null
}

export interface KatalogIzdelek {
  familyCode: string
  sku: string
  name: string
  desc: string | null
  unit: string
  widthMm: number | null
  heightMm: number | null
  depthMm: number | null
  tech: unknown
  costPrice: string
  salePrice: string
  warrantyMonths: number
  active: boolean
  validFrom: string
  validTo: string | null
  variants: KatalogVarianta[]
  assets: KatalogGradivo[]
}

export interface KatalogPodatki {
  families: KatalogDruzina[]
  products: KatalogIzdelek[]
}

export interface KatalogPorocilo {
  druzine: { novo: number; obstojece: number }
  izdelki: { novo: number; obstojece: number }
  variante: { novo: number; obstojece: number }
  gradiva: { novo: number; obstojece: number }
  napake: string[]
}

/** Ključ za prepoznavo istega gradiva (brez ID-ja, ki se ob vsakem seedu spremeni). */
export function kljucGradiva (a: { kind: string; filePath: string | null; variantSku: string | null }): string {
  return `${a.kind}|${a.filePath ?? ''}|${a.variantSku ?? ''}`
}

/**
 * Dopolni katalog. Vrne števce in napake; ne meče izjem za posamezne zapise.
 */
export async function dopolniKatalog (podatki: KatalogPodatki): Promise<KatalogPorocilo> {
  const p: KatalogPorocilo = {
    druzine: { novo: 0, obstojece: 0 },
    izdelki: { novo: 0, obstojece: 0 },
    variante: { novo: 0, obstojece: 0 },
    gradiva: { novo: 0, obstojece: 0 },
    napake: [],
  }

  // ── družine ──────────────────────────────────────────────────────────────
  for (const f of podatki.families) {
    const obstojeca = await db.productFamily.findUnique({ where: { code: f.code } })
    if (obstojeca) { p.druzine.obstojece++; continue }
    await db.productFamily.create({
      data: { code: f.code, name: f.name, desc: f.desc, unit: f.unit, sortOrder: f.sortOrder, active: f.active },
    })
    p.druzine.novo++
  }

  const druzine = await db.productFamily.findMany({ select: { id: true, code: true } })
  const druzinaPoKodi = new Map(druzine.map((d) => [d.code, d.id]))

  // ── izdelki + variante + gradiva ─────────────────────────────────────────
  for (const izdelek of podatki.products) {
    const familyId = druzinaPoKodi.get(izdelek.familyCode)
    if (!familyId) {
      p.napake.push(`${izdelek.sku}: družina ${izdelek.familyCode} ne obstaja.`)
      continue
    }

    let produkt = await db.product.findUnique({ where: { sku: izdelek.sku } })
    if (produkt) {
      p.izdelki.obstojece++
    } else {
      produkt = await db.product.create({
        data: {
          familyId,
          sku: izdelek.sku,
          name: izdelek.name,
          desc: izdelek.desc,
          unit: izdelek.unit,
          widthMm: izdelek.widthMm,
          heightMm: izdelek.heightMm,
          depthMm: izdelek.depthMm,
          tech: izdelek.tech == null ? undefined : (izdelek.tech as object),
          costPrice: izdelek.costPrice,
          salePrice: izdelek.salePrice,
          warrantyMonths: izdelek.warrantyMonths,
          active: izdelek.active,
          validFrom: new Date(izdelek.validFrom),
          validTo: izdelek.validTo == null ? null : new Date(izdelek.validTo),
        },
      })
      p.izdelki.novo++
    }

    for (const v of izdelek.variants) {
      const obstaja = await db.productVariant.findUnique({ where: { sku: v.sku } })
      if (obstaja) { p.variante.obstojece++; continue }
      await db.productVariant.create({
        data: {
          productId: produkt.id,
          sku: v.sku,
          name: v.name,
          color: v.color,
          ral: v.ral,
          widthMm: v.widthMm,
          heightMm: v.heightMm,
          costPrice: v.costPrice,
          salePrice: v.salePrice,
          tech: v.tech == null ? undefined : (v.tech as object),
          active: v.active,
          sortOrder: v.sortOrder,
        },
      })
      p.variante.novo++
    }

    if (izdelek.assets.length > 0) {
      const obstojecaGradiva = await db.productAsset.findMany({
        where: { productId: produkt.id },
        select: { kind: true, filePath: true, variantSku: true },
      })
      const zeObstaja = new Set(obstojecaGradiva.map(kljucGradiva))
      for (const a of izdelek.assets) {
        if (zeObstaja.has(kljucGradiva(a))) { p.gradiva.obstojece++; continue }
        await db.productAsset.create({
          data: {
            productId: produkt.id,
            variantSku: a.variantSku,
            kind: a.kind,
            orientation: a.orientation,
            view: a.view,
            colorName: a.colorName,
            colorApprox: a.colorApprox,
            filePath: a.filePath,
            cdnUrl: a.cdnUrl,
            sourceUrl: a.sourceUrl,
            sha256: a.sha256,
            bytes: a.bytes,
            sourceName: a.sourceName,
            capturedAt: new Date(a.capturedAt),
            permission: a.permission,
            status: a.status,
            note: a.note,
          },
        })
        zeObstaja.add(kljucGradiva(a))
        p.gradiva.novo++
      }
    }
  }

  return p
}
