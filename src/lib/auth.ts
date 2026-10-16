// auth — REKONSTRUKCIJA R431
// Seje: DVA nosilca žetona (R538):
//   1) Authorization: Bearer <token> — programski odjemalci + testni pas
//      (CSRF-varen dizajn, kot original; 45 skupin pasa odvisnih od njega);
//   2) httpOnly piškotek `roksal_session` — brskalnik (XSS ga ne more prebrati,
//      zato izluščitev skripta NE pomeni izluščitve seje).
// Oba izvora gresta čez ISTO sha256 pot (findSessionByToken) — smeti padajo
// na iskanje po zgoščenem ključu → fail-closed 401.
// Uporaba v API rutah:
//   const auth = await requirePermission(req, 'projects.read')
//   if (auth instanceof NextResponse) return auth
//   // auth.user, auth.perms

import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import type { ScryptOptions } from 'crypto'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { permissionsForRole, type Permission } from '@/lib/permissions-core'

// R538: izvoženo — login/setup/demo ga rabijo za maxAge piškotka
// (604800 s), da življenjska doba piškotka ostane USKLAJENA s sejno pogodbo.
export const SESSION_DAYS = 7

// ─── Sejna pogodba (R534, issue #21 §4 — pregled + uskladitev) ───────────────
// ŽIVLJENJSKA DOBA: 7 dni od prijave (SESSION_DAYS zgoraj). Dokumentacija
// (SECRETS.md/README) je bila neusklajena (30 dni / pepper+prstni odtis) —
// usklajena na to resnico; koda NI omehčana (7 < 30).
// SHRANJEVANJE: nosilec žetona je odjemalec; baza hrani SAMO SHA-256
// (sessionTokenHash). Izluščitev baze TAKO NE razkrije uporabnih žetonov.
// ZGODOVINSKE VRSTICE: stare seje s surovim žetonom (vsebuje piko) ostanejo
// veljavne — ob prvem uspešnem branju se NA MESTU nadgradijo v zgoščeno
// obliko (brezizpadni prehod; nobena seja ni preklicana).
// PREKLIC: odjava (trenutna), sprememba gesla (vse ostale), Varnost → Seje
// (posamično po id), potek (čistilna naloga jobs.ts) in onemogočen uporabnik
// (active=false blokira preverjanje ne glede na vrstico).
// ROTACIJA: ni potrebna — nova prijava izda nov žeton; stari poteče/prekliče se.

/** Zgoščevanje žetona seje za shranjevanje v bazi (SHA-256, hex). */
export function sessionTokenHash (token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ─── Zgoščevanje gesel (R536: scrypt N=2^17 + transparentna nadgradnja) ──────
// Format v2: `scrypt:131072:8:1:{salt}:{hash}` (6 delov; sol in hash hex, sol
// brez pik — zato split(':') ostane nedvoumen). Parametri po OWASP: N=2^17.
// Stari format `salt:hash` (2 dela, scrypt privzeti N=16384, r=8, p=1 —
// PREŠIBEK po reviziji) ostane VELJAVEN za branje; ob prijavi se tiho
// nadgradi (glej login route + passwordNeedsRehash).
//
// ASINHRONO: N=2^17 blokira event loop ~100 ms+; prijava/nastavitev sta redki
// operaciji, a asinhroni scrypt je pravilen (sync bi med eno prijavo zamrznil
// VSE sočasne zahteve tega procesa).
const SCRYPT_N = 131_072 // 2^17 (OWASP priporočilo)
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
// OBVEZNO: 128*N*r (~128 MiB) presega privzetih 32 MiB Node-ovega maxmem —
// brez tega scrypt vrže izjemo. 160 MiB pusti glavo za izvedbo.
const SCRYPT_MAXMEM = 160 * 1024 * 1024

const scryptAsync = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>

export async function hashPassword (password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash.toString('hex')}`
}

export async function verifyPassword (password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  let N = 16_384, r = 8, p = 1 // privzeti parametri STAREGA formata
  let salt = '', hash = ''
  if (parts.length === 6 && parts[0] === 'scrypt') {
    // v2: parametri so del zapisa
    N = Number(parts[1]); r = Number(parts[2]); p = Number(parts[3])
    salt = parts[4]; hash = parts[5]
    if (!Number.isInteger(N) || N <= 0 || !Number.isInteger(r) || r <= 0 || !Number.isInteger(p) || p <= 0) return false
  } else if (parts.length === 2) {
    // stari format `salt:hash` (N=16384, r=8, p=1 — scryptSync privzete vrednosti izvirnika)
    salt = parts[0]; hash = parts[1]
  } else {
    return false
  }
  if (!salt || !hash) return false
  const test = await scryptAsync(password, salt, SCRYPT_KEYLEN, { N, r, p, maxmem: SCRYPT_MAXMEM })
  const orig = Buffer.from(hash, 'hex')
  return test.length === orig.length && timingSafeEqual(test, orig)
}

/** Ali shranjeni hash zahteva nadgradnjo (stari format ALI N < 2^17)?
 * Klicatelj: login — po uspešni prijavi se hash TIHO prepiše v v2
 * (transparentna nadgradnja: uporabnik ne čuti nič; brez dodatnega audita —
 * LOGIN revizija že obstaja in zapisuje ISTI dogodek; nadgradnja ne spreminja
 * poverilnic, samo njihovo obliko). */
export function passwordNeedsRehash (stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true // stari format
  const N = Number(parts[1])
  return !Number.isInteger(N) || N < SCRYPT_N
}

// ─── Zaklepanje računa (R536 — druga plast zavor ob IP tempomatu) ───────────
// FIXNI (brez env): 5 zaporednih NEUSPEŠNIH prijav zaklene račun za 15 min.
// Uspešna prijava števec RESETIRA (testni pas r440-smoke s 645 uspešnimi
// prijavami tako ostane zelen — štejejo SAMO neuspešni poskusi). Zaklep ščiti
// RAČUN (tempomat v rate-limit.ts ščiti IP) — skupaj pokrijeta tako porazdeljen
// napad iz več IP-jev na en račun kot ponavljanje z enega IP-ja.
export const AUTH_LOCKOUT_MAX = 5
export const AUTH_LOCKOUT_MINUTES = 15

export interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  perms: string[]
}

export function toSessionUser (u: { id: string; email: string; name: string; role: string }): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, perms: permissionsForRole(u.role) }
}

/** Odjemalec, prek katerega se ustvari seja: globalni db ALI transakcijski
 * klient (tx) — R539 (transakcijska celovitost): login ustvari sejo v ENI
 * transakciji z resetom števca/zaklepa, morebitno nadgradnjo hasha in
 * revizijo LOGIN (isti vzorec kot writeAudit/recordEvent). Vsi ostali
 * klicatelji (demo, setup) ostajajo na privzetem db klientu. */
export type SessionClient = Pick<Prisma.TransactionClient, 'session'>

export async function createSession (userId: string, client: SessionClient = db): Promise<string> {
  const token = randomUUID() + '.' + randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000)
  // v bazi LE zgoščeno obliko — surov žeton pozna samo odjemalec (R534 #21 §4)
  await client.session.create({ data: { token: sessionTokenHash(token), userId, expiresAt } })
  return token
}

/** Poišče sejo po surovem žetonu: najprej zgoščeno, nato (zgodovinsko) surovo
 *  — ob zadetku surove vrstice jo NA MESTU nadgradi v zgoščeno (brezizpadni prehod). */
export async function findSessionByToken (token: string) {
  const hashed = sessionTokenHash(token)
  const session = await db.session.findUnique({ where: { token: hashed }, include: { user: true } })
  if (session) return session
  if (!token.includes('.')) return null // novejši žetoni vedno vsebujejo piko — ni zgodovinske vrstice
  const legacy = await db.session.findUnique({ where: { token }, include: { user: true } })
  if (!legacy) return null
  await db.session.updateMany({ where: { token }, data: { token: hashed } })
  return { ...legacy, token: hashed }
}

/** Prekliče sejo po surovem žetonu (pokrije zgoščeno IN zgodovinsko surovo vrstico). */
export async function deleteSessionsByToken (token: string): Promise<number> {
  const r = await db.session.deleteMany({ where: { token: { in: [sessionTokenHash(token), token] } } })
  return r.count
}

// ─── httpOnly piškotek seje (R538 — XSS ne more prebrati žetona) ─────────────
// Brskalnik ne potrebuje dostopa do žetona: enakonamen fetch piškotek pošlje
// sam, httpOnly pa JavaScriptu branje PREPREČI. Programska pot (testi, skripte)
// še naprej uporablja Bearer glavo — telo prijave žeton še vedno vrača.
export const SESSION_COOKIE = 'roksal_session'

/** Prebere surov žeton seje iz zahteve: Bearer glava (programski odjemalci,
 *  testi) ALI piškotek `roksal_session` (brskalnik). Bearer ima PREDNOST —
 *  če je glava prisotna, a neveljavna, se NE pademo na piškotek (fail-closed). */
export function readSessionToken (req: NextRequest): string | null {
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim()
    if (bearer) return bearer
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value.trim()
  return cookie || null
}

/** R538: nastavi httpOnly piškotek seje na odgovor (prijava/setup/demo).
 *  maxAge = SESSION_DAYS dni (604800 s) — v usklajenju s sejno pogodbo R534. */
export function setSessionCookie (res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  })
}

/** R538: počisti piškotek seje (odjava) — enaki zastavice, maxAge 0. */
export function clearSessionCookie (res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

export async function getSessionUser (req: NextRequest): Promise<SessionUser | null> {
  // R538: žeton seje prihaja iz Bearer glave (programski odjemalci/testi) ALI
  // iz httpOnly piškotka (brskalnik — XSS ga ne more prebrati); enaka sha256
  // pot za oba, smeti → zgrešeno iskanje → null (fail-closed).
  const token = readSessionToken(req)
  if (!token) return null
  const session = await findSessionByToken(token)
  if (!session || session.expiresAt < new Date() || !session.user.active) return null
  return toSessionUser(session.user)
}

export function jsonError (status: number, error: string, detail?: string): NextResponse {
  return NextResponse.json({ error, ...(detail ? { detail } : {}) }, { status })
}

export type AuthResult = { user: SessionUser; perms: string[] } | NextResponse

/** Vrata 1/1: zahtevana pravica (fail-closed). */
export async function requirePermission (req: NextRequest, perm: Permission): Promise<AuthResult> {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Zahtevan je veljaven Authorization: Bearer žeton ali seja prek piškotka.')
  if (!user.perms.includes(perm)) {
    return jsonError(403, `Dostop zavrnjen — manjka pravica ${perm}.`, 'Vrata določa permissions-core katalog.')
  }
  return { user, perms: user.perms }
}

// ─── Obseg podatkov (issue #1: monter vidi SAMO svoje projekte/naloge) ──────

/** Vidi vse projekte/naloge: ADMIN, VODJA, SKLADISCE, PROIZVODNJA (ne MONTER). */
export function readsAllData (user: { role: string }): boolean {
  return ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA'].includes(user.role)
}

/** Upravlja dodelitve (assignee): samo ADMIN in VODJA. */
export function managesAssignments (user: { role: string }): boolean {
  return user.role === 'ADMIN' || user.role === 'VODJA'
}

/** Preveri, da nalog pripada prijavljenemu monterju (sicer 403). */
export async function requireOwnWorkOrder (
  user: SessionUser,
  workOrderId: string
): Promise<{ id: string; projectId: string | null } | NextResponse> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, projectId: true, assigneeId: true },
  })
  if (!wo) return jsonError(404, 'Nalog ne obstaja.')
  if (wo.assigneeId !== user.id) {
    return jsonError(403, 'Nalog ni dodeljen vam.', 'Monter vidi samo svoje naloge; dodelitve upravlja pisarna.')
  }
  return { id: wo.id, projectId: wo.projectId }
}
