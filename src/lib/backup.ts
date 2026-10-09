// backup — R441 (issue #3): poganjač varnostnih kopij iz vzdrževalnega sistema.
// Jedro logike je v ops/backup.sh (en sam vir resnice za vse vnose: job, cron, ročno).
// Skrivnosti (šifrirno geslo, žeton) skripta prebere IZKLJUČNO iz okolja/.env.recovery.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface BackupOffsiteInfo {
  uploaded: boolean
  version: string
  chunks: number
  note: string
}

export interface BackupManifestInfo {
  provider: 'postgresql' | 'sqlite'
  tableCount: number
  totalRows: number
  /** Samo SQLite (RAW posnetek custom.db) — PostgreSQL kopija ga nima. */
  dbBytes?: number
}

export interface BackupResult {
  ok: boolean
  file: string
  bytes: number
  sha256: string
  encrypted: boolean
  gitSha: string
  gitBranch: string
  offsite: BackupOffsiteInfo
  durationSec: number
  createdAt: string
  manifest?: BackupManifestInfo
}

/**
 * Zažene ops/backup.sh in vrne njegov JSON povzetek.
 * R464: skripta se po providerju (PostgreSQL/SQLite) odloči prek DATABASE_URL —
 * okolje-processa posredujemo IZRECNO (nazadnje ROKSAL_DATABASE_URL), da tudi
 * zagon iz joba zadel pravo bazo ne glede na to, kje dev strežnik teče.
 * Časovna omejitev 10 min (dolga zgodovina + off-site nalaganje s ponovitvami).
 */
export async function runBackup (): Promise<BackupResult> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (!env.DATABASE_URL && env.ROKSAL_DATABASE_URL) env.DATABASE_URL = env.ROKSAL_DATABASE_URL
  const { stdout } = await execFileAsync('bash', ['ops/backup.sh'], {
    cwd: process.cwd(),
    env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  })
  // zadnja vrstica stdout je JSON povzetek (človeški dnevnik gre na stderr)
  const jsonLine = stdout.trim().split('\n').filter(l => l.trim().startsWith('{')).pop()
  if (!jsonLine) throw new Error('Varnostna kopija ni vrnila povzetka.')
  const parsed = JSON.parse(jsonLine) as BackupResult
  if (!parsed.ok) throw new Error('Varnostna kopija ni uspela.')
  return parsed
}
