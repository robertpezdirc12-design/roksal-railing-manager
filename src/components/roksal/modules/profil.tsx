'use client'

// PROFIL — moj profil, tema, dovoljenja, odjava

import { LogOut, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTheme } from 'next-themes'
import { useAppStore } from '@/lib/store'
import { apiPost } from '@/lib/api-client'
import { PageHeader } from '@/components/roksal/ui-bits'
import { ROLE_LABELS, ROLE_PERMISSIONS, type Role } from '@/lib/permissions-core'

export default function ProfilModule () {
  const { user, clearAuth } = useAppStore()
  const { theme, setTheme } = useTheme()
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
          <p><strong className="text-foreground">Roksal Railing Manager</strong> — rekonstrukcija R431 (6. 10. 2026).</p>
          <p>Vir blueprinta: Vercel deployment <span className="font-mono text-xs">dpl_EeeiLg…</span> (zadnji produkcijski build R430).</p>
          <p>Repozitorij: <span className="font-mono text-xs">gitlab.com/markec-group/roksal-railing-manager</span> (veja rekonstrukcija).</p>
        </CardContent>
      </Card>
    </div>
  )
}
