'use client'

// ModuleView — razdelilnik zavihkov → moduli (leno nalaganje + vrata po nav-registry)

import { Component, ComponentType, ReactNode, Suspense, lazy } from 'react'
import { RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { tabById, tabVisible } from '@/lib/nav-registry'
import { LoadingRows } from '@/components/roksal/ui-bits'
import { FadeIn } from '@/components/roksal/motion-bits'
import type { TabProps } from '@/components/roksal/modules/types'

// mapa zavihek → modul (vsak modul je svoja datoteka v ./modules/)
const MODULES: Record<string, () => Promise<{ default: ComponentType<TabProps> }>> = {
  danes: () => import('@/components/roksal/modules/danes'),
  playbook: () => import('@/components/roksal/modules/playbook'), // R458: vodeni postopek (issue #13)
  dashboard: () => import('@/components/roksal/modules/dashboard'),
  reports: () => import('@/components/roksal/modules/reports'), // R451: napredna poročila (issue #7 §16 P3)
  projekti: () => import('@/components/roksal/modules/projekti'),
  stranke: () => import('@/components/roksal/modules/stranke'),
  ponudbe: () => import('@/components/roksal/modules/ponudbe'),
  racuni: () => import('@/components/roksal/modules/racuni'),
  nalogi: () => import('@/components/roksal/modules/nalogi'),
  teren: () => import('@/components/roksal/modules/teren'),
  meritve: () => import('@/components/roksal/modules/meritve'),
  ogradnja: () => import('@/components/roksal/modules/ogradnja'), // R460: ograjni tekač (issue #15)
  zajem: () => import('@/components/roksal/modules/zajem'), // R461: reality capture QA (issue #16)
  dvojcek: () => import('@/components/roksal/modules/dvojcek'), // R461: digitalni dvojček (issue #16)
  model: () => import('@/components/roksal/modules/model'), // R473: merilni model (issue #9 §3)
  pregled: () => import('@/components/roksal/modules/pregled'), // R479: enotni pregledovalnik (issue #9 §7)
  foto: () => import('@/components/roksal/modules/foto'),
  nagib: () => import('@/components/roksal/modules/nagib'),
  konfigurator: () => import('@/components/roksal/modules/konfigurator'), // R447: konfigurator po družinah (nadomestil kalkulator)
  signatura: () => import('@/components/roksal/modules/signatura'),
  'material-v5': () => import('@/components/roksal/modules/material-v5'),
  predlogi: () => import('@/components/roksal/modules/predlogi'), // R452: avtomatski predlog materiala (issue #7 §16 P3)
  orodjarina: () => import('@/components/roksal/modules/orodjarina'),
  viz: () => import('@/components/roksal/modules/viz'),
  'foto-replace': () => import('@/components/roksal/modules/foto-replace'), // R459: foto vizualizacija (issue #14)
  ar: () => import('@/components/roksal/modules/ar'),
  crm: () => import('@/components/roksal/modules/crm'),
  dokumenti: () => import('@/components/roksal/modules/dokumenti'),
  zaloga: () => import('@/components/roksal/modules/zaloga'),
  katalog: () => import('@/components/roksal/modules/katalog'),
  logistika: () => import('@/components/roksal/modules/logistika'),
  dostave: () => import('@/components/roksal/modules/dostave'), // R445: dostave, vozila, ekipe
  servis: () => import('@/components/roksal/modules/servis'), // R446: garancije, reklamacije, servis
  proizvodnja: () => import('@/components/roksal/modules/proizvodnja'),
  galerija: () => import('@/components/roksal/modules/galerija'),
  varnost: () => import('@/components/roksal/modules/varnost'),
  'vodja-ekipa': () => import('@/components/roksal/modules/vodja-ekipa'),
  integracije: () => import('@/components/roksal/modules/integracije'), // R481: webhook naročnine (issue #9 §9)
  csp: () => import('@/components/roksal/modules/csp'), // R545: pregled CSP poročil (varnost)
  pdf: () => import('@/components/roksal/modules/pdf'),
  postsig: () => import('@/components/roksal/modules/postsig'),
  profil: () => import('@/components/roksal/modules/profil'),
}

// memoizirani lazy wrapperji — ustvarjeni ob zagonu modula (NE med renderjem)
const LazyModules: Record<string, ComponentType<TabProps>> = Object.fromEntries(
  Object.entries(MODULES).map(([id, loader]) => [id, lazy(loader)])
)

export function ModuleView ({ tabId }: { tabId: string }) {
  const user = useAppStore((s) => s.user)
  const tab = tabById(tabId)

  if (!tab) {
    return <NoAccess title="Neznani zavihek" desc={`Zavihek „${tabId}“ ni v registru (fail-closed).`} />
  }
  if (!tabVisible(user?.perms, tab)) {
    return (
      <NoAccess
        title="Dostop zavrnjen"
        desc={tab.gate ? `Ta zavihek zahteva pravico ${tab.gate}. Vrata določa permissions-core katalog.` : 'Ni dovoljenja.'}
      />
    )
  }

  const Mod = LazyModules[tab.id]
  if (!Mod) {
    return <NoAccess title="Modul ni implementiran" desc={`Zavihek „${tab.label}“ še čaka na implementacijo.`} />
  }
  // R535: modulni ErrorBoundary — pad enega modula NE pobije celotne lupine
  // (glava/navigacija/nadzor ostanejo živi). Boundary je NAD Suspense, da lovi
  // tudi napake lenega nalaganja (import). Key na tab.id resetira stanje ob preklopu.
  return (
    <ModuleErrorBoundary key={tab.id} tabId={tab.id}>
      <Suspense fallback={<LoadingRows rows={5} />}>
        <FadeIn>
          <Mod />
        </FadeIn>
      </Suspense>
    </ModuleErrorBoundary>
  )
}

// R535: razredna komponenta (error boundary — React ponuja samo class API).
// gumb „Ponovno naloži modul“ počisti stanje → React znova poskusi render.
class ModuleErrorBoundary extends Component<
  { children: ReactNode; tabId: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError (error: Error) {
    return { error }
  }

  componentDidCatch (error: Error) {
    // v razvijalsko konzolo; stack NE gre v uporabniški UI
    console.error(`[roksal] napaka v modulu "${this.props.tabId}":`, error)
  }

  render () {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center"
        >
          <TriangleAlert className="mb-3 size-10 text-amber-500" aria-hidden />
          <div className="font-medium text-foreground">Modul je naletel na napako</div>
          <div className="mt-1 max-w-md text-sm text-muted-foreground">
            Ostali deli aplikacije še delujejo. Podrobnost je v razvijalski konzoli.
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <RefreshCw className="size-4" aria-hidden /> Ponovno naloži modul
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function NoAccess ({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center" role="alert">
      <ShieldAlert className="mb-3 size-10 text-muted-foreground/50" aria-hidden />
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 max-w-md text-sm text-muted-foreground">{desc}</div>
    </div>
  )
}
