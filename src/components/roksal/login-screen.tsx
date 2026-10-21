'use client'

// Prijava — Roksal Railing Manager (rekonstrukcija R431)
// R435: če v sistemu ni še nobenega uporabnika, ponudi začetno namestitev
// (route-map izvirnika: /setup) — ustvari prvega ADMIN-a in prijavi.

import { FormEvent, useEffect, useState } from 'react'
import { Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { RoksalMark } from '@/components/roksal/logo'
import { useAppStore, type SessionUser } from '@/lib/store'
import { apiGet, apiPost } from '@/lib/api-client'

// R496: demo računove pridobimo s strežnika (GET /api/auth/demo) — gesla NISO
// več v odjemalskem svežnju. Demo panel se izriše samo, če je DEMO_ACCESS=on.
interface DemoAccount { email: string; label: string; hint: string }

export function LoginScreen () {
  const { toast } = useToast()
  const setAuth = useAppStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState<string | null>(null)
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([])

  // R435: stanje začetne namestitve (javni GET /api/setup)
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null)
  const [suName, setSuName] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suPassword, setSuPassword] = useState('')
  const [setupBusy, setSetupBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiGet<{ data: { needed: boolean } }>('/api/setup')
      .then((res) => { if (!cancelled) setSetupNeeded(res.data.needed) })
      .catch(() => { if (!cancelled) setSetupNeeded(false) })
    apiGet<{ data: { enabled: boolean; accounts: DemoAccount[] } }>('/api/auth/demo')
      .then((res) => { if (!cancelled) setDemoAccounts(res.data.enabled ? res.data.accounts : []) })
      .catch(() => { if (!cancelled) setDemoAccounts([]) })
    return () => { cancelled = true }
  }, [])

  async function login (em: string, pass: string) {
    const res = await apiPost<{ token: string; user: SessionUser }>('/api/auth/login', { email: em, password: pass })
    setAuth(res.token, res.user)
    toast({ title: `Dobrodošli, ${res.user.name}`, description: `Prijavljeni kot ${res.user.role}.` })
  }

  async function onSubmit (e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Napaka pri prijavi',
        description: err instanceof Error && 'detail' in err ? (err as { detail?: string }).detail : undefined,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  async function demoLogin (account: DemoAccount) {
    setDemoLoading(account.email)
    try {
      const res = await apiPost<{ data: { token: string; user: SessionUser } }>('/api/auth/demo', { email: account.email })
      setAuth(res.data.token, res.data.user)
      toast({ title: `Demo: ${account.label}`, description: `Prijavljeni kot ${res.data.user.role}.` })
    } catch (err) {
      toast({ title: 'Demo prijava ni uspela', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setDemoLoading(null)
    }
  }

  async function submitSetup (e: FormEvent) {
    e.preventDefault()
    setSetupBusy(true)
    try {
      const res = await apiPost<{ data: { token: string; user: SessionUser } }>('/api/setup', {
        name: suName, email: suEmail, password: suPassword,
      })
      setAuth(res.data.token, res.data.user)
      toast({ title: `Namestitev zaključena, ${res.data.user.name}`, description: 'Ustvarjen je administratorski račun.' })
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Namestitev ni uspela',
        description: err instanceof Error && 'detail' in err ? (err as { detail?: string }).detail : undefined,
        variant: 'destructive',
      })
    } finally {
      setSetupBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-roksal-navy-soft/10">
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <RoksalMark className="size-14 text-roksal-ink" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-roksal-ink dark:text-foreground">Roksal Railing Manager</h1>
              <p className="mt-1 text-sm text-muted-foreground">Upravljanje ograj — projekti, teren, proizvodnja</p>
            </div>
          </div>

          {setupNeeded ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Rocket className="size-5 text-roksal-amber" aria-hidden /> Začetna namestitev
                </CardTitle>
                <CardDescription>V sistemu ni uporabnikov — ustvarite prvi administratorski račun.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitSetup} className="space-y-4" aria-label="Začetna namestitev">
                  <div className="space-y-2">
                    <Label htmlFor="su-name">Ime in priimek</Label>
                    <Input
                      id="su-name" autoComplete="name" placeholder="npr. Robert Pezdirc"
                      value={suName} onChange={(e) => setSuName(e.target.value)} required minLength={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-email">E-pošta</Label>
                    <Input
                      id="su-email" type="email" autoComplete="email" placeholder="ime@roksal.si"
                      value={suEmail} onChange={(e) => setSuEmail(e.target.value)} required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-password">Geslo</Label>
                    <Input
                      id="su-password" type="password" autoComplete="new-password" placeholder="vsaj 8 znakov"
                      value={suPassword} onChange={(e) => setSuPassword(e.target.value)} required minLength={8}
                    />
                    <p className="text-xs text-muted-foreground">Ta obrazec je na voljo le enkrat — dokler ni uporabnikov.</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={setupBusy}>
                    {setupBusy ? 'Nameščam…' : 'Zaključi namestitev'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Prijava</CardTitle>
                  <CardDescription>Vnesite službene prijavne podatke.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onSubmit} className="space-y-4" aria-label="Prijava">
                    <div className="space-y-2">
                      <Label htmlFor="email">E-pošta</Label>
                      <Input
                        id="email" type="email" autoComplete="email" placeholder="ime@roksal.si"
                        value={email} onChange={(e) => setEmail(e.target.value)} required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Geslo</Label>
                      <Input
                        id="password" type="password" autoComplete="current-password" placeholder="••••••••"
                        value={password} onChange={(e) => setPassword(e.target.value)} required
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? 'Nalagam prijavo…' : 'Prijava'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {demoAccounts.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> Demo dostop <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {demoAccounts.map((u) => (
                      <Button
                        key={u.email} type="button" variant="outline" size="sm"
                        className="h-auto flex-col items-start gap-0.5 py-2 text-left"
                        onClick={() => void demoLogin(u)} disabled={!!demoLoading}
                        aria-label={`Demo prijava: ${u.label}`}
                      >
                        <span className="text-xs font-semibold">{u.label}</span>
                        <span className="text-[10px] font-normal text-muted-foreground">{u.hint}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <div className="mt-4 text-center">
        <a href="/demo" className="text-sm text-roksal-amber hover:underline">Brezplačen demo — preizkusite vse funkcije</a>
      </div>
      <footer className="mt-auto border-t bg-card/60 px-4 py-3 text-center text-xs text-muted-foreground">
        © 2026 Roksal d.o.o. · rekonstrukcija R431 (vir: Vercel deployment dpl_EeeiLg…)
      </footer>
    </div>
  )
}
