// cron — preverjanje Vercel cron klica (R496)
// Vercel cron pošlje HTTP GET na path iz vercel.json; če je v projektu nastavljena
// spremenljivka CRON_SECRET, samodejno doda glavo `Authorization: Bearer <CRON_SECRET>`.
// Brez te glave cron nima Bearer seje → brez CRON_SECRET je zavračen (fail-closed).

import { timingSafeEqual } from 'crypto'

function secret (): string {
  return process.env.CRON_SECRET?.trim() ?? ''
}

/**
 * Ali je prošnja res prišla od Vercel cron mehanizma.
 * Gosto preveri geslo v konstantnem času in brez CRON_SECRET vedno vrne false.
 */
export function isCronRequest (req: { headers: { get (name: string): string | null } }): boolean {
  const expected = secret()
  if (!expected) return false
  const header = req.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!provided) return false
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
