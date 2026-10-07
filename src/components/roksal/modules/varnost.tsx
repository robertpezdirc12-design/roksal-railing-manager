'use client'

// VARNOST — revizijski dnevnik (R428) + upravljanje sej (R433: security.read)

import { useState } from 'react'
import { LogIn, ScrollText, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, fmtDateTime, useApi } from '@/lib/api-client'
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
