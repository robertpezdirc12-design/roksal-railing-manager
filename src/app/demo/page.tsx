'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RoksalMark } from '@/components/roksal/logo'
import { apiGet, apiPost } from '@/lib/api-client'
import { useAppStore, type SessionUser } from '@/lib/store'
import { toast } from '@/hooks/use-toast'

interface DemoAccount { email: string; label: string; hint: string }

const DEMO_FEATURES = [
  { title: 'Fotomontaža', desc: 'Realna ograja Roksal na originalni fotografiji — perspektivna projekcija, sence, barvno usklajevanje. Ni animirana.' },
  { title: 'Merjenje', desc: '7 načinov (ograja, keramika, streha, fasada, stopnice, prostor, splošno), 6 kalibracijskih metod, Web Bluetooth laser meter (±1mm), WebXR AR (Android).' },
  { title: 'Projekti', desc: 'Upravljanje projektov, strank, ponudb, naročil, montaž.' },
  { title: 'Ponudbe & računi', desc: 'Generiranje ponudb, eSLOG fakturiranje, podpis stranke.' },
  { title: 'Skladišče', desc: 'Zaloga materialov, rezervacije, dobavnice.' },
  { title: 'Proizvodnja', desc: 'Delovni nalogi, CNC, CNC rezanje, sledenje.' },
  { title: 'CRM', desc: 'Stranke, komunikacija, opomniki.' },
  { title: 'PWA (offline)', desc: 'Deluje brez interneta — Service Worker, IndexedDB.' },
] as const

const FREE_NOTE = 'Brezplačen demo — ni potrebna kartica, ni registracije. Vsi podatki so demonstracijski in se redno resetirajo.'

export default function DemoPage () {
  const router = useRouter()
  const setAuth = useAppStore((s) => s.setAuth)
  const [accounts, setAccounts] = useState<DemoAccount[]>([])
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    apiGet<{ data: { enabled: boolean; accounts: DemoAccount[] } }>('/api/auth/demo')
      .then((res) => setAccounts(res.data.enabled ? res.data.accounts : []))
      .catch(() => setAccounts([]))
  }, [])

  async function enter (email: string) {
    setLoading(email)
    try {
      const res = await apiPost<{ data: { token: string; user: SessionUser } }>('/api/auth/demo', { email })
      setAuth(res.data.token, res.data.user)
      router.push('/')
    } catch (err) {
      toast({ title: 'Demo prijava ni uspela', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-roksal-navy-soft/10">
      <header className="border-b bg-card/60 px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <RoksalMark className="size-8 text-roksal-ink" />
          <h1 className="text-lg font-bold text-roksal-ink dark:text-foreground">Roksal — Brezplačen Demo</h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="mb-8 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-roksal-ink dark:text-foreground">Preizkusite vse funkcije brezplačno</h2>
          <p className="mt-2 text-muted-foreground">{FREE_NOTE}</p>
        </section>

        <section className="mb-8">
          <h3 className="mb-4 text-lg font-semibold text-roksal-ink dark:text-foreground">Kaj dobite v demu</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_FEATURES.map((f) => (
              <Card key={f.title}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{f.desc}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h3 className="mb-4 text-lg font-semibold text-roksal-ink dark:text-foreground">Demo računi (brezplačno)</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Demo računi trenutno niso na voljo. Za predstavitev nas kontaktirajte.</p>
            ) : (
              accounts.map((u) => (
                <Button
                  key={u.email} variant="outline" className="h-auto flex-col items-start gap-1 py-3 text-left"
                  onClick={() => void enter(u.email)} disabled={!!loading}
                >
                  <span className="text-sm font-semibold">{u.label}</span>
                  <span className="text-xs text-muted-foreground">{u.hint}</span>
                  <span className="text-[10px] text-muted-foreground">{u.email}</span>
                </Button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card/60 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Pomembno:</p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>Fotomontaža uporablja <strong>realne fotografije</strong> Roksal ograj — ni animirana, ni generirana. Originalna fotografija ostane nespremenjena, ograja se projicira s perspektivno projekcijo.</li>
            <li>Cloud procesiranje (Hover-style fotogrametrija) je <strong>opcijsko</strong> — uporablja Polycam API (brezplačni nivo). Brez njega deluje vse lokalno v brskalniku.</li>
            <li>Brezplačen demo ne zahteva plačila, kartice ali registracije.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}
