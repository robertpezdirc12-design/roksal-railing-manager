'use client'

// VARNOST — revizijski dnevnik (R428: per-projekt + sistemski/globalni pregled)

import { useState } from 'react'
import { ScrollText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppStore } from '@/lib/store'
import { fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { READS_ALL_PROJECTS } from '@/lib/permissions-core'

interface AuditRow {
  id: string; action: string; entity: string; entityId: string | null; projectId: string | null
  detail: string | null; createdAt: string
  user: { name: string; role: string } | null
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Prijava', LOGOUT: 'Odjava',
  USER_ROLE_CHANGE: 'Sprememba vloge', USER_ACTIVATE: 'Aktivacija', USER_DEACTIVATE: 'Deaktivacija',
  QUOTE_ISSUE: 'Izdaja ponudbe', PAYMENT_RECORD: 'Zapis plačila',
  WO_TRANSITION: 'Prehod naloga', PROJECT_UPDATE: 'Posodobitev projekta',
  STOCK_LOT_ADD: 'Sprejem zaloge', PRODUCTION_STATUS: 'Status proizvodnje',
  SETUP_COMPLETE: 'Zaključek nastavitve',
}

export default function VarnostModule () {
  const user = useAppStore((s) => s.user)
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

  return (
    <div className="space-y-4">
      <PageHeader title="Varnost — revizijski dnevnik" desc="Kdo je kdaj kaj naredil (R428: sistemski + per-projekt obseg)." />

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
