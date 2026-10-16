import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authRateLimited } from '@/lib/rate-limit'
import {
  AUTH_LOCKOUT_MAX, AUTH_LOCKOUT_MINUTES,
  createSession, hashPassword, jsonError, passwordNeedsRehash, setSessionCookie, toSessionUser, verifyPassword,
} from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { parseBody } from '@/lib/validate'

// /api/auth/login — prijava (route-map izvirnika)
// R496: zavora brute-force na IP (zdaj porazdeljena — baza, R536).
// R536: DVE plasti zavor: (1) tempomat login:ip:{ip} (rate-limit.ts),
// (2) ZAKLEP RAČUNA — 5 zaporednih neuspešnih prijav → lockedUntil +15 min
// (AUTH_LOCKOUT_* v auth.ts; uspešna prijava števec resetira).
// R536: scrypt v2 — po uspešnem verifyPassword se starejši hash TIHO nadgradi
// (passwordNeedsRehash; LOGIN revizija že pokriva dogodek).
// R538: ob uspehu sejo izdamo TUDI kot httpOnly piškotek `roksal_session`
// (brskalnik — XSS ga ne more prebrati); telo ODGOVORA še vedno nosi žeton —
// programska Bearer pot (testni pas, skripte) ostaja 100 % nespremenjena.
// R539 (transakcijska celovitost): uspešna prijava je VERIGA pisanj —
// reset števca/zaklepa + morebitna scrypt nadgradnja + seja + revizija LOGIN
// v ENI $transaction (padec srednjega koraka ne pusti sirot).

const LoginSchema = z.object({
  // zod v4 idiom: vrhnji z.email() (z.string().email() je opuščen)
  email: z.email('potrebna je veljavna e-pošta'),
  password: z.string().min(1, 'geslo ne sme biti prazno'),
})

export async function POST (req: NextRequest) {
  // plast 1: tempomat po IP (429 pred vsako rabo baze za geslo)
  if (await authRateLimited(req)) {
    return jsonError(429, 'Preveč poskusov prijave.', 'Počakaj eno minuto in poskusi znova.')
  }

  // validacija telesa (zod prek skupnega parseBody — sporočila ostanejo slovenska)
  const parsed = await parseBody(req, LoginSchema)
  if (!parsed.ok) return parsed.response
  const email = parsed.data.email.trim().toLowerCase() // baza hrani male črke (kot prej)
  const { password } = parsed.data

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !user.active) {
    // generično 401 — brez naštevanja (ne razkrivamo, ali račun obstaja)
    return jsonError(401, 'Neveljavna prijava.', 'E-pošta ali geslo ni pravilno.')
  }

  // zaklep: pred preverjanjem gesla (nadenapadalec ne more »črpati« verify)
  // TRADEOFF: 423 (Locked) RAZKRIVA obstoj računa — zavestno sprejeto, ker je
  // sporočilo nujno za poštenega uporabnika (ve, da je račun zaprt, ne da je
  // geslo napačno); obstoj računa sicer razkrijeta že pozaba-gesla tokovi.
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const min = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000))
    return jsonError(423, 'Račun je začasno zaklenjen.', `Poskusi znova čez ${min} minut.`)
  }

  if (!await verifyPassword(password, user.passwordHash)) {
    // neuspešno geslo: dvigni števec; ob presegu zakleni in resetiraj števec
    // (reset ob zaklepu: po 15 min ne začenjaš že »na robu« novega zaklepa)
    const after = await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    })
    if (after.failedLoginCount >= AUTH_LOCKOUT_MAX) {
      await db.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: new Date(Date.now() + AUTH_LOCKOUT_MINUTES * 60_000),
          failedLoginCount: 0,
        },
      })
    }
    return jsonError(401, 'Neveljavna prijava.', 'E-pošta ali geslo ni pravilno.')
  }

  // R539 (transakcijska celovitost): uspešna prijava ima 3–4 pisanja —
  // (a) reset števca/zaklepa, (b) scrypt nadgradnja hasha, (c) seja,
  // (d) revizija LOGIN. Vsa v ENI transakciji: prej bi padec srednjega koraka
  // pustil npr. nadgrajeno geslo brez seje ali resetiran zaklep brez revizije.
  // Drag scrypt izračun teče PREDAJ tx (telo transakcije ostane kratko —
  // enako kot auth/password v R538-b); žeton se vrne IZ tx, piškotek se
  // nastavi po uspešnem commitu na odgovoru (oblika odgovora nespremenjena).
  const rehash = passwordNeedsRehash(user.passwordHash) ? await hashPassword(password) : null
  const token = await db.$transaction(async (tx) => {
    // uspeh: reset števca/zaklepa, če je bil sploh dvignjen (pogoj — brez lišnih
    // pisanj ob vsaki navadni prijavi)
    if (user.failedLoginCount !== 0 || user.lockedUntil !== null) {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } })
    }

    // transparentna nadgradnja hasha (scrypt v2): uporabnik je pravkar dokazal
    // geslo — to je edini trenutek, ko imamo čisti tekst za nov izračun. Tiho,
    // brez dodatnega audita (LOGIN revizija že obstaja za isti dogodek).
    if (rehash !== null) {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: rehash } })
    }

    // seja (tx klient — R539) + revizija LOGIN, atomarno z zgornjimi popravki
    const created = await createSession(user.id, tx)
    await writeAudit({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id }, tx)
    return created
  })
  const res = NextResponse.json({ token, user: toSessionUser(user) })
  setSessionCookie(res, token) // R538: httpOnly piškotek za brskalnik (7 dni, R534)
  return res
}
