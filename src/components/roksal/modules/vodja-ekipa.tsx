'use client'

// VODJA / EKIPA — uporabniki in vloge (vrata users.read; spremembe users.write)

import { useState } from 'react'
import { Users } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPatch, fmtDate, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm, PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Role } from '@/lib/permissions-core'

interface UserRow { id: string; email: string; name: string; role: string; active: boolean; createdAt: string }

const ROLE_KEYS = Object.keys(ROLE_PERMISSIONS) as Role[]

export default function VodjaEkipaModule () {
  const me = useAppStore((s) => s.user)
  const { toast } = useToast()
  const list = useApi<{ data: UserRow[] }>('/api/users')
  const canWrite = hasPerm(me?.perms, 'users.write')
  const [busy, setBusy] = useState<string | null>(null)

  async function patch (id: string, patchBody: Record<string, unknown>, label: string) {
    setBusy(id)
    try {
      await apiPatch('/api/users', { id, ...patchBody })
      toast({ title: label })
      await list.reload()
    } catch (e) {
      toast({ title: 'Sprememba zavrnjena', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vodja / ekipa"
        desc={`Uporabniki, vloge in dovoljenja (permissions-core katalog: ${PERMISSIONS.length} pravic).`}
      />

      <ErrorBox error={list.error} />
      {list.loading ? <LoadingRows /> : !list.error && (list.data?.data ?? []).length === 0 ? (
        <EmptyState title="Ni uporabnikov" icon={Users} />
      ) : (
        <ul className="space-y-3">
          {(list.data?.data ?? []).map((u) => (
            <li key={u.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{u.name}</span>
                      <Badge variant="secondary" className="bg-roksal-ink text-primary-foreground">{ROLE_LABELS[u.role as Role] ?? u.role}</Badge>
                      {u.id === me?.id ? <Badge variant="outline">vi</Badge> : null}
                      {!u.active ? <Badge variant="destructive">neaktiven</Badge> : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{u.email} · od {fmtDate(u.createdAt)}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {ROLE_PERMISSIONS[u.role as Role]?.length ?? 0} pravic od {PERMISSIONS.length}
                    </div>
                  </div>
                  {canWrite ? (
                    <div className="flex items-center gap-3">
                      <Select
                        value={u.role} disabled={busy === u.id}
                        onValueChange={(v) => void patch(u.id, { role: v }, `Vloga spremenjena v ${v}.`)}
                      >
                        <SelectTrigger className="w-36" aria-label={`Vloga za ${u.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLE_KEYS.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={u.active} disabled={busy === u.id}
                          onCheckedChange={(c) => void patch(u.id, { active: c }, c ? 'Uporabnik aktiviran.' : 'Uporabnik deaktiviran.')}
                          aria-label={`Aktivnost za ${u.name}`}
                        />
                        <span className="text-xs text-muted-foreground">aktiven</span>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <p className="text-xs text-muted-foreground">
          Namig: spremembe vloge se zapišejo v revizijski dnevnik (USER_ROLE_CHANGE) — vidiš jih v zavihku Varnost.
        </p>
      ) : (
        <Button variant="outline" size="sm" disabled className="opacity-60">Urejanje zahteva pravico users.write</Button>
      )}
    </div>
  )
}
