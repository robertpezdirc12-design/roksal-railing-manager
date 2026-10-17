'use client'

// SERVIS — R446 (issue #7 §10, P2 SERVIS: garancije, reklamacije, servis).
// Zavihki: GARANCIJE (obstoječi Warranty/WarrantyVisit tok — R434) · REKLAMACIJE
//          (Claim: NOVA → V_OBRAVNAVI → ZAKLJUCENA/ZAVRNJENA) · SERVIS
//          (ServiceCase: PREVERITEV → ODOBRENA → V_SERVISU → ZAKLJUCEN + obiski).
// Tok iz spec: STRANKA → REKLAMACIJA → PREVERITEV → ODLOČITEV → SERVIS → ZAKLJUČEK.
// Vrata: projects.read (pogled); pisarniške mutacije (nova garancija/reklamacija,
//        odpiranje primera, odločitev, zaključek) → projects.write + readsAllData
//        (strežnik RES preverja — vazen UI); servisni obisk lahko TEHNIK zapiše
//        ZASE (nalog.write), pisarna pa za kogarkoli.
// MONTER: vidi SAMO zavihek Servis s svojimi primeri (brez pisalnih gumbov razen
//        dodaj obisk ZASE) — enak vzorec obsega kot dostave.tsx.
// R547: razbitje po vzorcu R546 — lupina drži zavihke, gradniki živijo v
//        servis-garancije/reklamacije/primeri + servis-shared.

import { useState } from 'react'
import { FileWarning, ShieldCheck, Wrench } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/lib/store'
import { PageHeader } from '@/components/roksal/ui-bits'
import { GarancijeTab } from './servis-garancije'
import { ReklamacijeTab } from './servis-reklamacije'
import { ServisTab } from './servis-primeri'

// ─── modul ────────────────────────────────────────────────────────────────────

export default function ServisModule () {
  const user = useAppStore((s) => s.user)
  const monterOnly = !!user && user.role === 'MONTER'
  const [tab, setTab] = useState('servis') // monter začne na servisu (edinem zavihku)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Servis"
        desc={monterOnly
          ? 'Vaši servisni primeri in obiski (issue #7 §10)'
          : 'Garancije, reklamacije in servisni primeri — tok stranka → reklamacija → preveritev → odločitev → servis → zaključek (issue #7 §10)'}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {monterOnly ? null : <TabsTrigger value="garancije"><ShieldCheck className="mr-1.5 size-4" aria-hidden /> Garancije</TabsTrigger>}
          {monterOnly ? null : <TabsTrigger value="reklamacije"><FileWarning className="mr-1.5 size-4" aria-hidden /> Reklamacije</TabsTrigger>}
          <TabsTrigger value="servis"><Wrench className="mr-1.5 size-4" aria-hidden /> Servis</TabsTrigger>
        </TabsList>
        {monterOnly ? null : <TabsContent value="garancije" className="mt-4"><GarancijeTab /></TabsContent>}
        {monterOnly ? null : <TabsContent value="reklamacije" className="mt-4"><ReklamacijeTab /></TabsContent>}
        <TabsContent value="servis" className="mt-4"><ServisTab /></TabsContent>
      </Tabs>
    </div>
  )
}
