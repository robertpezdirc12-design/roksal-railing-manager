'use client'

// VARNOST — revizijski dnevnik (R428) + upravljanje sej (R433: security.read)
// R435: vzdrževalna opravila (cron izvirnika) + licenca/aktivacija.

import { useState } from 'react'
import { BadgeCheck, KeyRound, LogIn, Play, ScrollText, Timer, Trash2, Wrench } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { READS_ALL_PROJECTS, hasPerm } from '@/lib/permissions-core'

interface AuditRow {
  id: string; action: string; entity: string; entityId: string | null; projectId: string | null
  detail: string | null; createdAt: string
  user: { name: string; role: string } | null
}

interface SessionRow {
  id: string; userId: string; createdAt: string; expiresAt: string; current: boolean
  user: { name: string; email: string } | null
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Prijava', LOGOUT: 'Odjava',
  USER_ROLE_CHANGE: 'Sprememba vloge', USER_ACTIVATE: 'Aktivacija', USER_DEACTIVATE: 'Deaktivacija',
  QUOTE_ISSUE: 'Izdaja ponudbe', PAYMENT_RECORD: 'Zapis plačila',
  WO_TRANSITION: 'Prehod naloga', WO_RESCHEDULE: 'Preurčitev naloga', PROJECT_UPDATE: 'Posodobitev projekta',
  STOCK_LOT_ADD: 'Sprejem zaloge', PRODUCTION_STATUS: 'Status proizvodnje',
  PASSWORD_CHANGE: 'Sprememba gesla', SESSION_REVOKE: 'Preklic seje', DOC_GENERATE: 'Izvoz PDF',
  EQUIP_CHECKOUT: 'Izposoja orodja', EQUIP_RETURN: 'Vrnitev orodja',
  SETUP_COMPLETE: 'Zaključek nastavitve',
  // R434:
  ESLOG_EXPORT: 'Izvoz eSLOG', QC_CHECK: 'Kontrola kakovosti',
  WARRANTY_CREATE: 'Oddaja garancije', WARRANTY_VISIT: 'Obisk garancije',
  // R435:
  PORTAL_CREATE: 'Nova povezava portala', PORTAL_REVOKE: 'Preklic povezave portala',
  MAINTENANCE_RUN: 'Vzdrževalno opravilo', ACTIVATION: 'Aktivacija licence',
}

export default function VarnostModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const [scope, setScope] = useState<'sistemski' | 'projekt'>(
    READS_ALL_PROJECTS.includes(user?.role as never) ? 'sistemski' : 'projekt'
  )
  const projects = useApi<{ data: { id: string; code: string; title: string }[] }>(scope === 'projekt' ? '/api/projects' : null, [scope])
  const [projectId, setProjectId] = useState<string | null>(null)

  const canSystem = READS_ALL_PROJECTS.includes(user?.role as never)
  const path = scope === 'sistemski'
    ? '/api/audit?limit=200'
    : projectId
      ? `/api/audit?projectId=${projectId}&limit=200`
      : null
  const entries = useApi<{ scope: string; data: AuditRow[] }>(path, [scope, projectId])

  // ── seje (R433: GET/DELETE /api/auth/sessions — security.read = ADMIN) ──
  const canSessions = hasPerm(user?.perms, 'security.read')
  const sessions = useApi<{ data: SessionRow[] }>(canSessions ? '/api/auth/sessions?all=1' : null, [canSessions])
  const [revoking, setRevoking] = useState<string | null>(null)
  async function revokeSession (id: string) {
    setRevoking(id)
    try {
      await apiDelete(`/api/auth/sessions/${id}`)
      toast({ title: 'Seja preklicana.' })
      sessions.reload()
    } catch (err) {
      toast({ title: 'Preklic ni uspel.', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Varnost — revizijski dnevnik" desc="Kdo je kdaj kaj naredil (R428: sistemski + per-projekt obseg)." />

      {canSessions ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="size-4 text-roksal-amber" aria-hidden /> Aktivne seje ({sessions.data?.data.length ?? 0})
            </CardTitle>
            <CardDescription>security.read — preklic tuje seje takoj razveljavi dostop (žeton iz briše).</CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.loading ? <LoadingRows rows={2} /> : sessions.error ? <ErrorBox error={sessions.error} /> : (sessions.data?.data ?? []).length === 0 ? (
              <EmptyState title="Ni aktivnih sej" desc="Nihče ni prijavljen." icon={LogIn} />
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {sessions.data.data.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{s.user?.name ?? '—'}</span>
                        {s.current ? <Badge className="border-transparent bg-roksal-amber text-roksal-ink">trenutna</Badge> : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{s.user?.email} · od {fmtDateTime(s.createdAt)} · poteče {fmtDateTime(s.expiresAt)}</div>
                    </div>
                    <Button
                      variant="ghost" size="icon" onClick={() => void revokeSession(s.id)} disabled={revoking === s.id}
                      aria-label={`Prekliči sejo uporabnika ${s.user?.name ?? ''}`}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {canSessions ? <MaintenanceCard /> : null}
      {canSessions ? <LicenceCard /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {canSystem ? (
          <Select value={scope} onValueChange={(v) => { setScope(v as 'sistemski' | 'projekt'); setProjectId(null) }}>
            <SelectTrigger className="w-44" aria-label="Obseg pregleda"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sistemski">Sistemski (globalni)</SelectItem>
              <SelectItem value="projekt">Po projektu</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {scope === 'projekt' ? (
          <Select value={projectId ?? ''} onValueChange={setProjectId}>
            <SelectTrigger className="w-64" aria-label="Projekt"><SelectValue placeholder="Izberi projekt …" /></SelectTrigger>
            <SelectContent>
              {(projects.data?.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {!canSystem ? (
          <Card><CardContent className="p-2 text-xs text-muted-foreground">
            Tvoja vloga vidi samo sled projekta (obseg vodenja zahteva ADMIN/VODJA/SKLADISCE/PROIZVODNJA).
          </CardContent></Card>
        ) : null}
      </div>

      <ErrorBox error={entries.error} />
      {entries.loading ? <LoadingRows rows={5} /> : !entries.error && (entries.data?.data ?? []).length === 0 ? (
        <EmptyState title="Ni vnosov" desc={scope === 'projekt' && !projectId ? 'Najprej izberi projekt.' : 'Dnevnik je prazen.'} icon={ScrollText} />
      ) : (
        <ul className="space-y-2">
          {(entries.data?.data ?? []).map((a) => (
            <li key={a.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[11px] font-semibold text-roksal-amber">
                        {ACTION_LABELS[a.action] ?? a.action}
                      </span>
                      <span className="text-xs text-muted-foreground">{a.user?.name ?? 'sistem'}</span>
                      <span className="text-[10px] text-muted-foreground/60">{a.user?.role}</span>
                    </div>
                    {a.detail ? <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{a.detail}</div> : null}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{fmtDateTime(a.createdAt)}</div>
                    <div className="text-[10px] text-muted-foreground/60">{a.entity}{a.projectId ? ' · projekt' : ' · sistemski'}</div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Vzdrževanje (R435: cron opravila izvirnika — ročni zagon + dnevnik) ─────

interface JobDef {
  job: string; label: string; desc: string; cron: string
  last: { ok: boolean; affected: number; startedAt: string; finishedAt: string; user: { name: string } | null } | null
}

function MaintenanceCard () {
  const { toast } = useToast()
  const jobs = useApi<{ data: { definitions: JobDef[]; runs: { id: string; job: string; ok: boolean; affected: number; startedAt: string; finishedAt: string; user: { name: string } | null }[] } }>('/api/jobs', [])
  const [running, setRunning] = useState<string | null>(null)

  async function run (job: string) {
    setRunning(job)
    try {
      const res = await apiPost<{ data: { job: string; affected: number; durationMs: number } }>('/api/jobs', { job })
      toast({
        title: `${res.data.job} zaključeno.`,
        description: `Spremenjenih zapisov: ${res.data.affected} · ${res.data.durationMs} ms.`,
      })
      await jobs.reload()
    } catch (e) {
      toast({ title: 'Zagon ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setRunning(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="size-4 text-roksal-amber" aria-hidden /> Vzdrževanje
        </CardTitle>
        <CardDescription>Redna opravila (cron izvirnika) — tu jih lahko ADMIN zažene takoj; vsak zagon je zabeležen.</CardDescription>
      </CardHeader>
      <CardContent>
        {jobs.loading ? <LoadingRows rows={2} /> : jobs.error ? <ErrorBox error={jobs.error} /> : (
          <ul className="space-y-1.5">
            {(jobs.data?.data.definitions ?? []).map((d) => (
              <li key={d.job} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{d.label}</span>
                    <code className="rounded bg-secondary px-1 font-mono text-[10px] text-muted-foreground">{d.job}</code>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.desc}</p>
                  {d.last ? (
                    <p className="mt-0.5 inline-flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      <Timer className="size-3" aria-hidden />
                      zadnji zagon {fmtDateTime(d.last.startedAt)} · {d.last.affected} zapisov
                      {d.last.user ? ` · ${d.last.user.name}` : ' · sistem'} · {d.last.ok ? 'uspešno' : 'napaka'}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">še ni zagnano</p>
                  )}
                </div>
                <Button
                  size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void run(d.job)} disabled={running === d.job}
                >
                  <Play className="size-3.5" aria-hidden /> {running === d.job ? 'Teče…' : 'Zaženi'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── Licenca (R435: /aktivacija izvirnika) ───────────────────────────────────

interface LicenceState {
  status: string; key: string | null; activatedAt: string | null; activatedBy: string | null
}

function LicenceCard () {
  const { toast } = useToast()
  const licence = useApi<{ data: LicenceState }>('/api/aktivacija', [])
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const active = licence.data?.data.status === 'AKTIVNA'

  async function activate () {
    if (!key.trim()) { toast({ title: 'Vnesite ključ.', variant: 'destructive' }); return }
    setBusy(true)
    try {
      await apiPost('/api/aktivacija', { key })
      toast({ title: 'Licenca aktivirana.', description: 'Hvala za zaupanje.' })
      setKey('')
      await licence.reload()
    } catch (e) {
      toast({ title: 'Aktivacija ni uspela.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-roksal-amber" aria-hidden /> Licenca
        </CardTitle>
        <CardDescription>Status aplikacije po licenci (route-map izvirnika: /aktivacija).</CardDescription>
      </CardHeader>
      <CardContent>
        {licence.loading ? <LoadingRows rows={1} /> : licence.error ? <ErrorBox error={licence.error} /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {active ? (
                <Badge className="gap-1 border-transparent bg-emerald-700 text-white"><BadgeCheck className="size-3" aria-hidden /> Aktivna</Badge>
              ) : (
                <Badge variant="secondary">Neaktivna (demo)</Badge>
              )}
              {licence.data?.data.key ? (
                <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">{licence.data.data.key}</code>
              ) : null}
              {licence.data?.data.activatedAt ? (
                <span className="text-[11px] text-muted-foreground">
                  od {fmtDateTime(licence.data.data.activatedAt)} · {licence.data.data.activatedBy}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                value={key} onChange={(e) => setKey(e.target.value.toUpperCase())}
                placeholder="RS-XXXXX-XXXXX-XXXXX" className="min-w-0 flex-1 font-mono" aria-label="Aktivacijski ključ"
                onKeyDown={(e) => { if (e.key === 'Enter') void activate() }}
              />
              <Button size="sm" onClick={() => void activate()} disabled={busy}>
                {busy ? 'Preverjam…' : 'Aktiviraj'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
