'use client'

// PROFIL — moj profil, tema, geslo (R433), seje, dovoljenja, odjava
// R438 (issue #5): razdelek Obveščanje — nastavitve kanalov po tipu dogodka.

import { useEffect, useState } from 'react'
import { BellRing, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTheme } from 'next-themes'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { ROLE_LABELS, ROLE_PERMISSIONS, type Role } from '@/lib/permissions-core'

export default function ProfilModule () {
  const { user, clearAuth } = useAppStore()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()

  // ── sprememba gesla (R433: POST /api/auth/password) ──
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  async function changePassword (e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    if (next !== next2) { toast({ title: 'Novi gesli se ne ujemata.', variant: 'destructive' }); return }
    if (next.length < 8) { toast({ title: 'Novo geslo mora imeti vsaj 8 znakov.', variant: 'destructive' }); return }
    setPwBusy(true)
    try {
      const r = await apiPost<{ sessionsRevoked: number }>('/api/auth/password', { current: cur, next })
      toast({ title: 'Geslo spremenjeno.', description: r.sessionsRevoked > 0 ? `Preklicanih sej: ${r.sessionsRevoked}.` : undefined })
      setCur(''); setNext(''); setNext2('')
    } catch (err) {
      toast({ title: 'Sprememba gesla ni uspela.', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setPwBusy(false)
    }
  }

  if (!user) return null

  const perms = ROLE_PERMISSIONS[user.role as Role] ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Moj profil" desc="Identiteta, dovoljenja in nastavitve." />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {user.name}
            <Badge variant="secondary" className="bg-roksal-ink text-primary-foreground">{ROLE_LABELS[user.role as Role] ?? user.role}</Badge>
          </CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? '☀️ Svetla tema' : '🌙 Temna tema'}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => { void apiPost('/api/auth/logout').catch(() => {}); clearAuth() }}>
              <LogOut className="size-4" aria-hidden /> Odjava
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-roksal-amber" aria-hidden /> Sprememba gesla
          </CardTitle>
          <CardDescription>Po uspehu se vse druge seje prekličejo (varnost).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid max-w-md gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pw-cur">Trenutno geslo</Label>
              <Input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new">Novo geslo (min. 8 znakov)</Label>
              <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new2">Novo geslo (ponovno)</Label>
              <Input id="pw-new2" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} required minLength={8} />
            </div>
            <Button type="submit" disabled={pwBusy || !cur || !next || !next2} className="w-fit">
              {pwBusy ? 'Shranjujem …' : 'Spremeni geslo'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ObvescanjeCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-roksal-amber" aria-hidden /> Dovoljenja ({perms.length})
          </CardTitle>
          <CardDescription>permissions-core katalog — kaj smem po vlogi (fail-closed).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {perms.map((p) => <Badge key={p} variant="secondary" className="font-mono text-[11px]">{p}</Badge>)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">O rekonstrukciji</CardTitle>
          <CardDescription />
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p><strong className="text-foreground">Roksal Railing Manager</strong> — rekonstrukcija R431–R433 (6.–7. 10. 2026).</p>
          <p>Vir blueprinta: Vercel deployment <span className="font-mono text-xs">dpl_EeeiLg…</span> (zadnji produkcijski build R430).</p>
          <p>Repozitorij: <span className="font-mono text-xs">gitlab.com/markec-group/roksal-railing-manager</span> (veja rekonstrukcija).</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Obveščanje (R438, issue #5): nastavitve kanalov po tipu dogodka ─────────

interface PrefEventRow {
  event: string
  label: string
  channels: Record<string, boolean>
}

function ObvescanjeCard () {
  const { toast } = useToast()
  const prefs = useApi<{ data: { events: PrefEventRow[] } }>('/api/notifications/prefs', [])
  const [matrix, setMatrix] = useState<PrefEventRow[] | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set()) // dejanja v teku (event|kanal)

  useEffect(() => {
    if (prefs.data?.data.events) setMatrix(prefs.data.data.events)
  }, [prefs.data])

  async function toggle (row: PrefEventRow, channel: 'IN_APP' | 'EMAIL', enabled: boolean) {
    if (!matrix) return
    const prev = matrix
    const stamp = `${row.event}|${channel}`
    // optimistično: takoj preklopi + toast, nato shrani
    setMatrix(matrix.map((e) => e.event === row.event ? { ...e, channels: { ...e.channels, [channel]: enabled } } : e))
    toast({
      title: enabled ? 'Obvestilo vklopljeno.' : 'Obvestilo izklopljeno.',
      description: `${row.label} · ${channel === 'IN_APP' ? 'v aplikaciji' : 'e-pošta'}`,
    })
    setBusy(new Set([...busy, stamp]))
    try {
      await apiPost('/api/notifications/prefs', { event: row.event, channel, enabled })
    } catch (err) {
      setMatrix(prev) // povratek na prejšnje stanje
      toast({ title: 'Shranjevanje ni uspelo.', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      const next = new Set([...busy])
      next.delete(stamp)
      setBusy(next)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-roksal-amber" aria-hidden /> Obveščanje
        </CardTitle>
        <CardDescription>
          Kateri poslovni dogodki te obvestijo in po katerem kanalu. E-pošta je privzeto izklopljena; SMS kanal še ni konfiguriran.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {prefs.loading ? <LoadingRows rows={4} /> : prefs.error ? <ErrorBox error={prefs.error} /> : !matrix || matrix.length === 0 ? (
          <EmptyState title="Ni nastavitev" desc="Seznam dogodkov ni na voljo." icon={BellRing} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Dogodek</TableHead>
                  <TableHead className="text-center">V aplikaciji</TableHead>
                  <TableHead className="text-center">E-pošta</TableHead>
                  <TableHead className="text-center">SMS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrix.map((row) => (
                  <TableRow key={row.event}>
                    <TableCell className="py-2 text-sm font-medium">
                      {row.label}
                      {row.event === '*' ? <span className="ml-1 text-[10px] text-muted-foreground">(za vse dogodke)</span> : null}
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Switch
                        checked={!!row.channels.IN_APP}
                        disabled={busy.has(`${row.event}|IN_APP`)}
                        onCheckedChange={(v) => void toggle(row, 'IN_APP', v)}
                        aria-label={`${row.label} — obvestilo v aplikaciji`}
                      />
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Switch
                        checked={!!row.channels.EMAIL}
                        disabled={busy.has(`${row.event}|EMAIL`)}
                        onCheckedChange={(v) => void toggle(row, 'EMAIL', v)}
                        aria-label={`${row.label} — obvestilo po e-pošti`}
                      />
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Switch checked={false} disabled aria-label="SMS kanal ni konfiguriran" />
                      <span className="block text-[10px] text-muted-foreground">ni konfiguriran</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
