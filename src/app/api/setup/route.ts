import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authRateLimited } from '@/lib/rate-limit'
import { createSession, hashPassword, jsonError, toSessionUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

// /api/setup — začetna namestitev (route-map izvirnika: /setup)
// GET  (javno): { needed } — ali aplikacija še nima nobenega uporabnika
// POST (javno, SAMO ko ni uporabnikov): ustvari prvega ADMIN-a in prijavi
// Takoj ko obstaja vsaj en uporabnik, POST vrne 403 (enkratna zaklenjena vrata).
// Revizija: SETUP_COMPLETE.
//
// R534 (issue #21 §3): ATOMARNOST prve namestitve. Prej sta bila števec
// (user.count) in ustvarjanje uporabnika DVE ločeni operaciji — dve hkratni
// javni POST zahtevi sta obe preverili števec na 0 in ustvarili DVA admina.
// Omejitev poskusov v pomnilniku tempomata ni dokaz atomarnosti.
// Zdaj: celega prevzema ne odloča več števec, temveč ATOMARNA ZAHTEVA lastništva
// — vstavljanje vrstice Setting 'system.setup.completedAt', kjer je Setting.key
// PRIMARNI KLJUČ baze. Transakcija: zahteva (PK) + ponovni števec + uporabnik +
// revizija so ENA atomska enota; sočasni zahtevi čakata na isti ključ, druga
// dobi P2002 po zavezi zmagovalke in prejme 403. Vrstico zapiše tudi demo-seed
// (seed.cjs) — zato delno pobrisana baza NE more ponovno odpreti javnih vrat.

export const dynamic = 'force-dynamic'

export const SETUP_CLAIM_KEY = 'system.setup.completedAt'

export async function GET () {
  const count = await db.user.count()
  const claim = await db.setting.findUnique({ where: { key: SETUP_CLAIM_KEY } }).catch(() => null)
  return NextResponse.json({ data: { needed: count === 0 && claim === null, users: count } })
}

export async function POST (req: NextRequest) {
  // R496: okno namestitve je javno — omejimo poskuse na IP (first-comer prevzeme SYSTEM);
  // R536: tempomat je porazdeljen (baza) — await
  if (await authRateLimited(req)) {
    return jsonError(429, 'Preveč poskusov.', 'Počakaj eno minuto in poskusi znova.')
  }

  // hitra pot (informativna — avtoriteta je transakcija spodaj): končana
  // namestitev takoj zavrne, brez razčlenjevanja telesa (kot doslej)
  const zeUporabnikov = await db.user.count()
  if (zeUporabnikov > 0 || await db.setting.findUnique({ where: { key: SETUP_CLAIM_KEY } }).catch(() => null)) {
    return jsonError(403, 'Namestitev je že zaključena.', 'Obstojeci uporabniki se prijavijo običajno.')
  }

  const body = await req.json().catch(() => null) as { name?: string; email?: string; password?: string } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (name.length < 2) return jsonError(400, 'Ime je prekratko.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(400, 'Neveljaven e-poštni naslov.')
  if (password.length < 8) return jsonError(400, 'Geslo mora imeti vsaj 8 znakov.')

  try {
    const user = await db.$transaction(async (tx) => {
      // avtoritativni števec ZNOTRAJ transakcije (hitra pot zgoraj ni dokaz)
      const count = await tx.user.count()
      if (count > 0) throw new KonecNamestitve()

      // ATOMARNA ZAHTEVA lastništva prve administracije: Setting.key je PK —
      // vstavljanje je ekskluzivno; P2002 pomeni »nekdo je že prevzel«.
      await tx.setting.create({
        data: { key: SETUP_CLAIM_KEY, value: new Date().toISOString() },
      })

      const created = await tx.user.create({
        // R536: hashPassword je asinhrona (scrypt N=2^17) — await ZNOTRAJ tx
        data: { email, passwordHash: await hashPassword(password), name, role: 'ADMIN' },
      })

      // revizija V isti transakciji (writeAudit sprejema transakcijski klient —
      // atomarna z uporabnikom; R464 vzorec)
      await writeAudit({
        userId: created.id, action: 'SETUP_COMPLETE', entity: 'sistem',
        detail: { note: 'Začetna namestitev — prvi administrator', email },
      }, tx)

      return created
    })

    const token = await createSession(user.id)
    return NextResponse.json({ data: { token, user: toSessionUser(user) } }, { status: 201 })
  } catch (e) {
    if (e instanceof KonecNamestitve) {
      return jsonError(403, 'Namestitev je že zaključena.', 'Obstajajoči uporabniki se prijavijo običajno.')
    }
    // P2002 na Setting PK = sočasna namestitev je ZMAGOVALA (issue #21 §3)
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return jsonError(403, 'Namestitev je že zaključena.', 'Sočasna zahteva je prevzela prvo administracijo.')
    }
    throw e
  }
}

/** Notranji signal za hitro pot znotraj transakcije (preveden v 403). */
class KonecNamestitve extends Error {
  constructor () {
    super('setup že zaključen')
    this.name = 'KonecNamestitve'
  }
}
