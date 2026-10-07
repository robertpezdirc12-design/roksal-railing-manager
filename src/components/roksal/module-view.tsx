'use client'

// ModuleView — razdelilnik zavihkov → moduli (leno nalaganje + vrata po nav-registry)

import { ComponentType, Suspense, lazy } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { tabById, tabVisible } from '@/lib/nav-registry'
import { LoadingRows } from '@/components/roksal/ui-bits'
import type { TabProps } from '@/components/roksal/modules/types'

// mapa zavihek → modul (vsak modul je svoja datoteka v ./modules/)
const MODULES: Record<string, () => Promise<{ default: ComponentType<TabProps> }>> = {
  danes: () => import('@/components/roksal/modules/danes'),
  dashboard: () => import('@/components/roksal/modules/dashboard'),
  projekti: () => import('@/components/roksal/modules/projekti'),
  stranke: () => import('@/components/roksal/modules/stranke'),
  ponudbe: () => import('@/components/roksal/modules/ponudbe'),
  racuni: () => import('@/components/roksal/modules/racuni'),
  nalogi: () => import('@/components/roksal/modules/nalogi'),
  teren: () => import('@/components/roksal/modules/teren'),
  meritve: () => import('@/components/roksal/modules/meritve'),
  foto: () => import('@/components/roksal/modules/foto'),
  nagib: () => import('@/components/roksal/modules/nagib'),
  konfigurator: () => import('@/components/roksal/modules/konfigurator'), // R447: konfigurator po družinah (nadomestil kalkulator)
  signatura: () => import('@/components/roksal/modules/signatura'),
  'material-v5': () => import('@/components/roksal/modules/material-v5'),
  orodjarina: () => import('@/components/roksal/modules/orodjarina'),
  viz: () => import('@/components/roksal/modules/viz'),
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
  return (
    <Suspense fallback={<LoadingRows rows={5} />}>
      <Mod />
    </Suspense>
  )
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
