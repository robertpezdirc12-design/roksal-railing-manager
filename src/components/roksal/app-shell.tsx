'use client'

// App ogrodje — ciljna IA po R448 (issue #7 §11): DANES | PRODAJA | PROJEKTI |
// OPERATIVA | SKLADIŠČE | KATALOG | FINANCE | SERVIS | POROČILA | VARNOST | PROFIL.
// Desktop: stranska vrstica z vsemi razpoložljivimi sekcijami (scroll).
// Mobile: spodnja vrstica = prvih 4 razpoložljivih sekcij + gumb Več (Sheet z vsemi).
// R433: globalno iskanje (Ctrl+K / gumb povečevala) — /api/search, obseg po pravicah.
// R439 (issue #6): OfflineBadge v glavi + samodejna sinhronizacija (initOfflineSync)
// + clearOfflineData ob odjavi (varnostna zahteva — vrsta NE sme preživeti odjave).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { Bell, Cloud, CloudOff, LogOut, Moon, MoreHorizontal, RefreshCw, Search, Sun, Ruler, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { useToast } from '@/hooks/use-toast'
import { ROLE_LABELS, type Role } from '@/lib/permissions-core'
import { SECTIONS, sectionForTab, tabById, tabVisible } from '@/lib/nav-registry'
// R544: globoka povezava ?m= — URL odraz zavihka + zgodovina (back gumb)
import { tabFromSearch, pushTabState, clearTabState } from '@/lib/deep-link'
import { apiGet, apiPost, fmtDateTime, useApi } from '@/lib/api-client'
import {
  bindOfflineUser, clearOfflineData, dismissOp, getOfflineState, initOfflineSync, listUnsynced, syncNow, useOnline,
  type OfflineState, type QueueOp,
} from '@/lib/offline'
import { RoksalLogo } from '@/components/roksal/logo'
import { ModuleView } from '@/components/roksal/module-view'
import { useOnboarding } from '@/components/roksal/onboarding'
// R490 (issue #11): SMART GUIDE — kontekstna pomoč SL/HR + glas (Web Speech API)
import { SmartGuide } from '@/components/roksal/smart-guide'

interface NotificationRow { id: string; title: string; body: string; read: boolean; createdAt: string }

interface SearchHit { id: string; label: string; sub: string; section: string; tab: string; kind: string }
interface SearchGroup { kind: string; label: string; hits: SearchHit[] }

export function AppShell () {
  const { user, section, tab, setSection, setTab, clearAuth } = useAppStore()
  useOnboarding([
    { element: "nav", title: "Navigacija", text: "Tukaj izbirate med 5 glavnimi sekcijami." },
    { element: "main", title: "Moduli", text: "Tukaj se izrisuje izbrani modul." },
  ])
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const notif = useApi<{ data: NotificationRow[]; unread: number }>('/api/notifications')

  // ── globalno iskanje (R433) ──
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchHits, setSearchHits] = useState<SearchGroup[]>([])
  const [searching, setSearching] = useState(false)
  // R536: debounce ~200 ms — vsak pritisk tipke NE sproži laste zahteve;
  // rezultati/prikaz ostajajo identični, čistilni vzorec (clearTimeout).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── R448 (§11): mobilni Sheet „Več" — seznam vseh razpoložljivih sekcij ──
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    function onKey (e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // R439 (issue #6): samodejna sinhronizacija — 'online' dogodek + interval 30 s.
  // ZAČNE šele PO vezavi uporabnika: more bitno čiščenje vrste prejšnjega
  // uporabnika (drug račun na isti napravi) mora potekati PREJ, preden se
  // karkoli pošlje na strežnik (varnostna zahteva issue #6).
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    let cleanup: (() => void) | null = null
    void bindOfflineUser(user.id).then((r) => {
      if (cancelled) return
      if (r === 'cleared') {
        toast({
          title: 'Lokalni podatki prejšnjega uporabnika izbrisani',
          description: 'Na tej napravi so bili shranjeni nerešeni offline podatki drugega računa.',
        })
      }
      cleanup = initOfflineSync()
    }).catch(() => {
      if (!cancelled) cleanup = initOfflineSync()
    })
    return () => { cancelled = true; cleanup?.() }
  }, [user?.id, toast])

  const runSearch = useCallback((q: string) => {
    setSearchQ(q)
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null }
    if (q.trim().length < 2) { setSearchHits([]); setSearching(false); return }
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null
      setSearching(true)
      const url = `/api/search?q=${encodeURIComponent(q.trim())}`
      apiGet<{ data: { groups: SearchGroup[] } }>(url)
        .then((r) => setSearchHits(r.data.groups))
        .catch(() => setSearchHits([]))
        .finally(() => setSearching(false))
    }, 200)
  }, [])

  // R536: ob odklopu komponente počistimo morebitni čakajoči iskalni timeout
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])

  // R544: URL odraz zavihka (?m=). Inicialni sync ob mountu — URL zmaga nad
  // persistom (roksal-session): globoka povezava /?m=nalogi odpre Nalogi tudi
  // po prijavi (LoginScreen ne navigira, ?m preživi). Neveljaven ?m (neznan id
  // ali zavihek brez pravice — tabVisible fail-closed) → clearTabState, stanje
  // ostane na persistanem zavihku. popstate → enak sync za BACK gumb.
  useEffect(() => {
    const syncFromUrl = () => {
      const wanted = tabFromSearch(window.location.search)
      if (!wanted) return // brez ?m → brez spremembe (persist prevzame)
      const tab = tabById(wanted)
      const sec = sectionForTab(wanted)
      if (!tab || !sec || !tabVisible(useAppStore.getState().user?.perms, tab)) {
        clearTabState()
        return
      }
      const st = useAppStore.getState()
      if (st.section !== sec.id || st.tab !== tab.id) {
        st.setSection(sec.id)
        st.setTab(tab.id)
      }
    }
    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
    return () => { window.removeEventListener('popstate', syncFromUrl) }
  }, [])

  function goToHit (hit: SearchHit) {
    setSearchOpen(false)
    setSection(hit.section)
    setTab(hit.tab)
    pushTabState(hit.tab)
  }

  if (!user) return null

  function pickSection (id: string) {
    setSection(id)
    const sec = SECTIONS.find((s) => s.id === id)
    const first = sec?.tabs.find((t) => tabVisible(user?.perms, t))
    // R544: prvi videni zavihek gremo v URL (pushState); sekcija brez vidnih
    // zavihkov → odstranimo ?m iz naslova.
    if (first) { setTab(first.id); pushTabState(first.id) } else { clearTabState() }
  }

  function openNotifications (open: boolean) {
    if (open && notif.data && notif.data.unread > 0) {
      void apiPost('/api/notifications').then(() => notif.reload()).catch(() => {})
    }
  }

  async function logout () {
    try { await apiPost('/api/auth/logout') } catch { /* seja že potekla */ }
    // R439 (issue #6): varnost — ob odjavi izbriši VSE offline shrambe (vrsta/foto/predpomnilnik)
    await clearOfflineData()
    clearAuth()
  }

  const currentSection = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const currentTab = currentSection.tabs.find((t) => t.id === tab)
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()

  // R448 (§11): razpoložljivost sekcij po pravicah — mobilna vrstica pokaže
  // prvih 4 + gumb Več (Sheet z vsemi); če jih je ≤ 5, pokažemo vse brez Več.
  const availableSections = SECTIONS.filter((sec) => sec.tabs.some((t) => tabVisible(user.perms, t)))
  const barSections = availableSections.length > 5 ? availableSections.slice(0, 4) : availableSections
  const needsMore = availableSections.length > 5

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

          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* R439 (issue #6): stanje signala + vrsta offline operacij */}
            <OfflineBadge />

            {/* R490 (issue #11): kontekstna pomoč za trenutni modul (SL/HR + glas) */}
            <SmartGuide />

            <Button
              variant="ghost" onClick={() => setSearchOpen(true)}
              className="h-9 gap-2 rounded-full px-3 text-muted-foreground"
              aria-label="Globalno iskanje (Ctrl+K)"
            >
              <Search className="size-4" aria-hidden />
              <span className="hidden text-xs sm:inline">Iskanje</span>
              <kbd className="ml-1 hidden rounded border bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground lg:inline">Ctrl K</kbd>
            </Button>

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
                <DropdownMenuItem onClick={() => { setSection('profil'); setTab('profil'); pushTabState('profil') }}>
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

      {/* globalno iskanje (R433) */}
      <CommandDialog
        open={searchOpen} onOpenChange={setSearchOpen}
        title="Globalno iskanje" description="Išči po projektih, strankah, ponudbah, računih, nalogih in zalogi."
      >
        <CommandInput value={searchQ} onValueChange={runSearch} placeholder="Išči projekte, stranke, ponudbe, račune, naloge …" />
        <CommandList>
          {searching ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Iščem …</div>
          ) : searchQ.trim().length < 2 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Vnesi vsaj 2 znaka.</div>
          ) : searchHits.length === 0 ? (
            <CommandEmpty>Ni zadetkov za „{searchQ}“.</CommandEmpty>
          ) : (
            searchHits.map((g) => (
              <CommandGroup key={g.kind} heading={g.label}>
                {g.hits.map((h) => (
                  <CommandItem key={`${h.kind}-${h.id}`} value={`${h.label} ${h.sub}`} onSelect={() => goToHit(h)}>
                    <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{h.sub}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))
          )}
        </CommandList>
      </CommandDialog>

      {/* telo */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-3 pb-24 pt-4 sm:px-4 md:pb-8">
        {/* stranska vrstica — desktop */}
        <nav aria-label="Glavna navigacija" className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-20 max-h-[calc(100vh-9.375rem)] space-y-4 overflow-y-auto pr-1">
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
                          type="button" onClick={() => { setSection(sec.id); setTab(t.id); pushTabState(t.id) }}
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
                  onClick={() => { setTab(t.id); pushTabState(t.id) }}
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

      {/* spodnja navigacija — mobile (R448 §11: prvih 4 razpoložljivih sekcij + Več) */}
      <nav
        aria-label="Navigacija sekcij" role="navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {barSections.map((sec) => {
            const Icon = SECTION_ICONS[sec.id]
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
          {needsMore ? (
            <button
              type="button" onClick={() => setMoreOpen(true)}
              className={cn(
                'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-semibold transition',
                availableSections.slice(4).some((s) => s.id === section)
                  ? 'text-roksal-amber'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-label="Več sekcij"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="size-5" aria-hidden />
              Več
            </button>
          ) : null}
        </div>
      </nav>

      {/* R448 (§11): Sheet z vsemi razpoložljivimi sekcijami (mobilni „Več") */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <SheetHeader className="pb-0">
            <SheetTitle className="text-base">Vse sekcije</SheetTitle>
            <SheetDescription className="sr-only">Izberi sekcijo, na katero želiš preklopiti.</SheetDescription>
          </SheetHeader>
          <ul className="grid grid-cols-3 gap-2 px-4 pb-2 pt-3 sm:grid-cols-4" aria-label="Seznam sekcij">
            {availableSections.map((sec) => {
              const Icon = SECTION_ICONS[sec.id]
              const active = section === sec.id
              return (
                <li key={sec.id}>
                  <button
                    type="button"
                    onClick={() => { setMoreOpen(false); pickSection(sec.id) }}
                    className={cn(
                      'flex min-h-[64px] w-full flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-semibold transition',
                      active
                        ? 'border-roksal-amber bg-roksal-amber/10 text-roksal-amber'
                        : 'border-border bg-background text-muted-foreground hover:border-roksal-amber/50 hover:text-foreground'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="size-5" aria-hidden />
                    {sec.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── R439 (issue #6): OfflineBadge — stanje signala + vrsta sinhronizacije ───

const OP_KIND_LABELS: Record<string, string> = {
  meritev: 'Meritev',
  foto: 'Fotografija z merjenjem',
  'nalog-opomba': 'Opomba naloga',
  'nalog-status': 'Sprememba statusa',
  'nalog-zakljucek': 'Zaključek terena',
}

function OfflineBadge () {
  const { toast } = useToast()
  const online = useOnline() // R439: takojšen odziv na online/offline dogodke
  const [state, setState] = useState<OfflineState | null>(null)
  const [detail, setDetail] = useState<QueueOp[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void getOfflineState().then(setState).catch(() => {})
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5_000)
    const on = () => void refresh()
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [refresh])

  // osveži podrobnosti ob spremembi stanja
  useEffect(() => {
    void listUnsynced().then(setDetail).catch(() => {})
  }, [state])

  async function runSync () {
    setBusy(true)
    const res = await syncNow()
    setBusy(false)
    refresh()
    if (res.error) {
      toast({ title: 'Sinhronizacija ni uspela', description: res.error, variant: 'destructive' })
    } else if (res.skipped === 'offline') {
      toast({ title: 'Še brez povezave', description: 'Operacije bodo poslane, ko se signal vrne.' })
    } else {
      const parts = [
        res.synced ? `${res.synced} uspešno` : null,
        res.conflicts ? `${res.conflicts} konflikt${res.conflicts === 1 ? '' : 'ov'}` : null,
        res.errors ? `${res.errors} napak${res.errors === 1 ? 'a' : ''}` : null,
      ].filter(Boolean)
      toast({
        title: 'Sinhronizacija zaključena',
        description: parts.length > 0 ? parts.join(' · ') : 'Ni bilo čakajočih sprememb.',
      })
    }
  }

  const unsynced = state ? state.pending + state.conflicts + state.errors : 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" className="h-9 gap-1.5 rounded-full px-2.5 text-muted-foreground"
          aria-label={online
            ? (unsynced > 0 ? `Povezava vzpostavljena — ${unsynced} sprememb čaka na sinhronizacijo` : 'Povezava vzpostavljena')
            : 'Brez povezave — spremembe se shranjujejo lokalno'}
          title={online ? 'Sinhronizacija — stanje povezave' : 'Brez povezave — offline način'}
        >
          <span className="relative flex">
            {online ? <Cloud className="size-5" aria-hidden /> : <CloudOff className="size-5" aria-hidden />}
            <span
              className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card', online ? 'bg-emerald-500' : 'bg-muted-foreground/50')}
              aria-hidden
            />
          </span>
          {unsynced > 0 ? (
            <span className="text-xs font-bold text-orange-600 dark:text-orange-400">
              {unsynced} čaka
              <span className="sr-only"> na sinhronizacijo</span>
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {online
                ? <><Cloud className="size-4 text-emerald-600" aria-hidden /> Online</>
                : <><CloudOff className="size-4 text-muted-foreground" aria-hidden /> Brez povezave</>}
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                online
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <span className={cn('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-muted-foreground/60')} aria-hidden />
              {online ? 'signal je nazaj' : 'offline način'}
            </span>
          </div>

          <dl className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
            <div className="rounded-lg bg-secondary/60 p-2">
              <dt className="text-muted-foreground">Čakajoče spremembe</dt>
              <dd className="text-base font-bold">{state?.pending ?? 0}</dd>
            </div>
            <div className="rounded-lg bg-secondary/60 p-2">
              <dt className="text-muted-foreground">Čakajoče fotografije</dt>
              <dd className="text-base font-bold">{state?.photos ?? 0}</dd>
            </div>
            <div className={cn('rounded-lg p-2', (state?.conflicts ?? 0) > 0 ? 'bg-red-100 dark:bg-red-950/60' : 'bg-secondary/60')}>
              <dt className={(state?.conflicts ?? 0) > 0 ? 'font-semibold text-red-700 dark:text-red-300' : 'text-muted-foreground'}>Konflikti</dt>
              <dd className={cn('text-base font-bold', (state?.conflicts ?? 0) > 0 && 'text-red-700 dark:text-red-300')}>{state?.conflicts ?? 0}</dd>
            </div>
            <div className={cn('rounded-lg p-2', (state?.errors ?? 0) > 0 ? 'bg-amber-100 dark:bg-amber-950/60' : 'bg-secondary/60')}>
              <dt className="text-muted-foreground">Napake</dt>
              <dd className="text-base font-bold">{state?.errors ?? 0}</dd>
            </div>
          </dl>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Zadnja sinhronizacija: {state?.lastSync ? fmtDateTime(state.lastSync) : '—'}
          </p>

          {detail.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1" aria-label="Neusklajene operacije">
              {detail.map((op) => (
                <li key={op.opId} className="rounded-lg border px-2 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{OP_KIND_LABELS[op.kind] ?? op.kind}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                          op.status === 'conflict'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                            : op.status === 'error'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-secondary text-secondary-foreground'
                        )}
                      >
                        {op.status === 'conflict' ? 'konflikt' : op.status === 'error' ? 'napaka' : 'čaka'}
                      </span>
                      {/* R439: konflikt/napaka je REŠLJIVA — uporabnik sprejme stanje strežnika */}
                      {op.status === 'conflict' || op.status === 'error' ? (
                        <button
                          type="button"
                          onClick={() => {
                            void dismissOp(op.opId).then(() => {
                              void listUnsynced().then(setDetail).catch(() => {})
                              refresh()
                            }).catch(() => {})
                          }}
                          className="rounded p-0.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={`Odstrani iz vrste: ${OP_KIND_LABELS[op.kind] ?? op.kind} (sprejme stanje strežnika)`}
                          title="Odstrani iz vrste (sprejme stanje strežnika)"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {op.error ? <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{op.error}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {(state?.conflicts ?? 0) > 0 ? (
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
              Konflikti ostajajo v vrsti — na strežniku je stanje že drugačno (npr. nalog je že v novem statusu).
            </p>
          ) : null}

          <Button
            size="sm" className="mt-2 w-full" disabled={busy || !online || unsynced === 0}
            onClick={() => void runSync()}
          >
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} aria-hidden />
            Sinhroniziraj zdaj
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Ikone sekcij po IA R448 (§11) — lucide poti, isti inline SVG stil.
const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  danes: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M8 2v4" /><path d="M12 2v4" /><path d="M16 2v4" /><rect width="16" height="18" x="4" y="4" rx="2" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></svg>,
  prodaja: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>,
  projekti: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /></svg>,
  operativa: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></svg>,
  skladisce: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" /><path d="M6 18h12" /><path d="M6 14h12" /><rect width="12" height="12" x="6" y="6" /></svg>,
  katalog: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>,
  finance: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" /></svg>,
  servis: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>,
  porocila: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>,
  varnost: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></svg>,
  profil: (props) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><circle cx="12" cy="8" r="4" /><path d="M6 21v-1a6 6 0 0 1 12 0v1" /></svg>,
}
