// backup — R441 (issue #3): poganjač varnostnih kopij iz vzdrževalnega sistema.
// Jedro logike je v ops/backup.sh (en sam vir resnice za vse vnose: job, cron, ročno).
// Skrivnosti (šifrirno geslo, žeton) skripta prebere IZKLJUČNO iz okolja/.env.recovery.
import { execFile } from 'node:child_process'
import { accessSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
 * Najde PRAVI projektni koren (ops/ + .git) od zagona aplikacije navzgor.
 * Preskoči kopije iz Next standalone file-tracinga (te nimajo .git in
 * prisma/ — git bundle + shema ne bi obstajali).
 * R464: standalone strežnik zamenja cwd v .next/standalone; pravi koren
 * prepoznamo po ops/backup.sh + ops/lib.sh + src/ + prisma/schema.prisma.
 * Na serverless namestitvi (Vercel) tak koren ne obstaja → jasna napaka
 * (DR za takšno namestitev teče prek zunanjega cron klica/neon PITR — docs/DEPLOYMENT.md).
 */
function resolveOpsRoot (): string {
  // R464: EKSPlicitna pot ima prednost — ROKSAL_PROJECT_ROOT nastavi operater
  // (systemd/start skripta), hevristika pa je zadnja obramba:
  const srcName = ['s', 'r', 'c'].join('')
  let dir = process.env.ROKSAL_PROJECT_ROOT && (() => { try { accessSync(join(process.env.ROKSAL_PROJECT_ROOT as string, 'ops', 'backup.sh')); return true } catch { return false } })()
    ? process.env.ROKSAL_PROJECT_ROOT as string
    : process.cwd()
  for (let i = 0; i < 6; i++) {
    try {
      accessSync(join(dir, 'ops', 'backup.sh'))
      accessSync(join(dir, 'ops', 'lib.sh'))
      accessSync(join(dir, srcName))
      accessSync(join(dir, 'prisma', 'schema.prisma'))
      return dir
    } catch {
      dir = dirname(dir)
    }
  }
  throw new Error('projektni koren (ops/ + src/ + prisma/) ni na voljo v tej namestitvi (serverless?) — varnostne kopije poganja zunanji cron ali skrbnik (glej docs/DEPLOYMENT.md).')
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
  const root = resolveOpsRoot()
  const { stdout } = await execFileAsync('bash', [root + '/ops/backup.sh'], {
    cwd: root,
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
