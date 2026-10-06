'use client'

// Prijava — Roksal Railing Manager (rekonstrukcija R431)

import { FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { RoksalLogo, RoksalMark } from '@/components/roksal/logo'
import { useAppStore, type SessionUser } from '@/lib/store'
import { apiPost } from '@/lib/api-client'

const DEMO_USERS = [
  { email: 'admin@roksal.si', password: 'Admin123!', label: 'Administrator', hint: 'Robert Pezdirc' },
  { email: 'vodja@roksal.si', password: 'Vodja123!', label: 'Vodja', hint: 'Matej Kovač' },
  { email: 'monter@roksal.si', password: 'Monter123!', label: 'Monter', hint: 'Luka Novak' },
  { email: 'skladisce@roksal.si', password: 'Skladisce123!', label: 'Skladišče', hint: 'Tomaž Zupan' },
  { email: 'proizvodnja@roksal.si', password: 'Proizvodnja123!', label: 'Proizvodnja', hint: 'Ana Kos' },
]

export function LoginScreen () {
  const { toast } = useToast()
  const setAuth = useAppStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState<string | null>(null)

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

  async function demoLogin (u: (typeof DEMO_USERS)[number]) {
    setDemoLoading(u.email)
    try {
      await login(u.email, u.password)
    } catch (err) {
      toast({ title: 'Demo prijava ni uspela', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setDemoLoading(null)
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

          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> Demo dostop <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {DEMO_USERS.map((u) => (
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
        </div>
      </main>
      <footer className="mt-auto border-t bg-card/60 px-4 py-3 text-center text-xs text-muted-foreground">
        © 2026 Roksal d.o.o. · rekonstrukcija R431 (vir: Vercel deployment dpl_EeeiLg…)
      </footer>
    </div>
  )
}
