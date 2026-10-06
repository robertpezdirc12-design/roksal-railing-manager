'use client'

// App ogrodje — IA po R429: DANES | PROJEKTI | ZAJEM | PISARNA | PROFIL
// Desktop: stranska vrstica z zavihki. Mobile: spodnja navigacija (danes PRVI, R429) + tabletke zavihkov.

import { useTheme } from 'next-themes'
import { Bell, LogOut, Moon, Sun, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { ROLE_LABELS, type Role } from '@/lib/permissions-core'
import { SECTIONS, tabVisible } from '@/lib/nav-registry'
import { apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import { RoksalLogo } from '@/components/roksal/logo'
import { ModuleView } from '@/components/roksal/module-view'

interface NotificationRow { id: string; title: string; body: string; read: boolean; createdAt: string }

export function AppShell () {
  const { user, section, tab, setSection, setTab, clearAuth } = useAppStore()
  const { theme, setTheme } = useTheme()
  const notif = useApi<{ data: NotificationRow[]; unread: number }>('/api/notifications')

  if (!user) return null

  function pickSection (id: string) {
    setSection(id)
    const sec = SECTIONS.find((s) => s.id === id)
    const first = sec?.tabs.find((t) => tabVisible(user?.perms, t))
    if (first) setTab(first.id)
  }

  function openNotifications (open: boolean) {
    if (open && notif.data && notif.data.unread > 0) {
      void apiPost('/api/notifications').then(() => notif.reload()).catch(() => {})
    }
  }

  async function logout () {
    try { await apiPost('/api/auth/logout') } catch { /* seja že potekla */ }
    clearAuth()
  }

  const currentSection = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const currentTab = currentSection.tabs.find((t) => t.id === tab)
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* glava */}
      <header className="sticky top-0 z-30 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-2 px-3 sm:px-4">
          <button
            type="button" onClick={() => pickSection('danes')}
            className="rounded-lg px-1 py-1 transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Roksal Railing Manager — domov"
          >
            <RoksalLogo compact />
          </button>

          <div className="hidden min-w-0 flex-1 items-center gap-2 px-4 md:flex" aria-current="page">
            <span className="truncate text-sm font-semibold text-foreground">{currentSection.label}</span>
            {currentTab && currentTab.id !== currentSection.id ? (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="truncate text-sm text-muted-foreground">{currentTab.label}</span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Popover onOpenChange={openNotifications}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label="Obvestila">
                  <Bell className="size-5" />
                  {notif.data && notif.data.unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-roksal-amber text-[10px] font-bold text-roksal-ink">
                      {notif.data.unread}
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="max-h-96 overflow-y-auto p-2">
                  <div className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Obvestila</div>
                  {notif.loading ? (
                    <div className="p-4 text-sm text-muted-foreground">Nalagam…</div>
                  ) : !notif.data || notif.data.data.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">Ni obvestil.</div>
                  ) : (
                    notif.data.data.map((n) => (
                      <div key={n.id} className={cn('rounded-lg p-3', !n.read && 'bg-secondary/60')}>
                        <div className="text-sm font-medium leading-snug">{n.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{n.body}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground/70">{fmtDateTime(n.createdAt)}</div>
                      </div>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Preklopi temo"
            >
              <Sun className="size-5 dark:hidden" /><Moon className="hidden size-5 dark:block" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="Uporabniški meni"
                >
                  <Avatar className="size-8 border">
                    <AvatarFallback className="bg-roksal-ink text-xs font-bold text-primary-foreground">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block max-w-28 truncate text-xs font-semibold">{user.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{ROLE_LABELS[user.role as Role] ?? user.role}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{user.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
                  <Badge variant="secondary" className="mt-1.5 bg-roksal-ink text-primary-foreground">
                    {ROLE_LABELS[user.role as Role] ?? user.role}
                  </Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setSection('profil'); setTab('profil') }}>
                  <Ruler className="size-4" aria-hidden /> Moj profil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
                  <LogOut className="size-4" aria-hidden /> Odjava
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* telo */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-3 pb-24 pt-4 sm:px-4 md:pb-8">
        {/* stranska vrstica — desktop */}
        <nav aria-label="Glavna navigacija" className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-5 overflow-y-auto pr-1">
            {SECTIONS.map((sec) => {
              const tabs = sec.tabs.filter((t) => tabVisible(user.perms, t))
              if (tabs.length === 0) return null
              return (
                <div key={sec.id}>
                  <button
                    type="button" onClick={() => pickSection(sec.id)}
                    className={cn(
                      'mb-1 w-full rounded-lg px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest transition',
                      section === sec.id ? 'text-roksal-amber' : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-current={section === sec.id ? 'true' : undefined}
                  >
                    {sec.label}
                  </button>
                  <ul className="space-y-0.5">
                    {tabs.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button" onClick={() => { setSection(sec.id); setTab(t.id) }}
                          className={cn(
                            'w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition',
                            tab === t.id
                              ? 'bg-roksal-ink text-primary-foreground shadow-sm'
                              : 'text-foreground/80 hover:bg-secondary'
                          )}
                          aria-current={tab === t.id ? 'page' : undefined}
                        >
                          {t.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </nav>

        {/* vsebina */}
        <main className="min-w-0 flex-1" aria-live="polite">
          {/* tabletke zavihkov znotraj sekcije */}
          {currentSection.tabs.filter((t) => tabVisible(user.perms, t)).length > 1 ? (
            <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label={`Zavihki — ${currentSection.label}`}>
              {currentSection.tabs.filter((t) => tabVisible(user.perms, t)).map((t) => (
                <button
                  key={t.id} type="button" role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition',
                    tab === t.id
                      ? 'border-transparent bg-roksal-ink text-primary-foreground'
                      : 'border-border bg-card text-foreground/70 hover:bg-secondary'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}

          <ModuleView tabId={tab} />
        </main>
      </div>

      {/* noga — prilepljena dnu (kratka vsebina), naravno potisnjena dol (dolga vsebina) */}
      <footer className="mt-auto border-t bg-card/60 px-4 py-2.5 text-center text-[11px] text-muted-foreground">
        © 2026 Roksal d.o.o. · Roksal Railing Manager — rekonstrukcija R431 · build {typeof window === 'undefined' ? '' : new Date().getFullYear()}
      </footer>

      {/* spodnja navigacija — mobile (DANES prvi, R429) */}
      <nav
        aria-label="Navigacija sekcij" role="navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {SECTIONS.map((sec) => {
            const Icon = SECTION_ICONS[sec.id]
            const available = sec.tabs.some((t) => tabVisible(user.perms, t))
            if (!available) {
              return <div key={sec.id} className="flex items-center justify-center py-1" aria-disabled="true" />
            }
            return (
              <button
                key={sec.id} type="button" onClick={() => pickSection(sec.id)}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-semibold transition',
                  section === sec.id ? 'text-roksal-amber' : 'text-muted-foreground hover:text-foreground'
                )}
                aria-current={section === sec.id ? 'page' : undefined}
              >
                <Icon className="size-5" aria-hidden />
                {sec.label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  danes: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M8 2v4" /><path d="M12 2v4" /><path d="M16 2v4" /><rect width="16" height="18" x="4" y="4" rx="2" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></svg>,
  projekti: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></svg>,
  zajem: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 8V6a2 2 0 0 1 2-2h2" /><path d="M20 8V6a2 2 0 0 0-2-2h-2" /><path d="M4 16v2a2 2 0 0 0 2 2h2" /><path d="M20 16v2a2 2 0 0 1-2 2h-2" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>,
  pisarna: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 21h18" /><path d="M6 21V8l6-5 6 5v13" /><path d="M10 21v-4h4v4" /><path d="M9 10h.01M15 10h.01" /></svg>,
  profil: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="8" r="4" /><path d="M6 21v-1a6 6 0 0 1 12 0v1" /></svg>,
}
