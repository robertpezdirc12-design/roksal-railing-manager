'use client'

// DOSTAVE — R445 (issue #7 §9, P1 DELIVERY + INSTALLATION).
// Zavihki: DOSTAVE (tok NAČRTOVANO → PRIPRAVLJENO → NATOVARJENO → NA_POTI → DOSTAVLJENO)
//          · VOZILA · EKIPE IN PODIZVAJALCI.
// Vrata: projects.read (pogled — monter vidi SAMO svoje dostave, kar določa API),
//        projects.write (pisarna: ustvarjanje/urejanje — strežnik dodatno zahteva
//        obseg readsAllData, tako da monterjev terenski projects.read/write tu ne zadostiva),
//        load/depart/deliver lahko izvede tudi VOZNIK dostave (strežnik preverja).
// OPOMBA (IA): zavihek je v sekciji PISARNA; ciljna IA §11 (sekcija OPERATIVA) pride
//        s poznejšo restrukturacijo navigacije.
//
// R549: ta datoteka je VSTOPNA (zavihki). Gradniki živijo v poddatotekah:
// shared (tipi/statusi/isOffice), tab (seznam + dialoga), detail (podrobnost +
// prehodi), nova (nova dostava), vozila, ekipe — bajtno-identični premiki,
// brez spremembe obnašanja (recept R546–R548).

import { useState } from 'react'
import { CarFront, Truck, Users } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/roksal/ui-bits'
import { DostaveTab } from './dostave-tab'
import { VozilaTab } from './dostave-vozila'
import { EkipeTab } from './dostave-ekipe'

export default function DostaveModule () {
  const [tab, setTab] = useState('dostave')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Dostave"
        desc="Dostave, vozila in ekipe — tok načrtovano → pripravljeno → natovorjeno → na poti → dostavljeno (issue #7 §9)"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="dostave"><Truck className="mr-1.5 size-4" aria-hidden /> Dostave</TabsTrigger>
          <TabsTrigger value="vozila"><CarFront className="mr-1.5 size-4" aria-hidden /> Vozila</TabsTrigger>
          <TabsTrigger value="ekipe"><Users className="mr-1.5 size-4" aria-hidden /> Ekipe in podizvajalci</TabsTrigger>
        </TabsList>
        <TabsContent value="dostave" className="mt-4"><DostaveTab /></TabsContent>
        <TabsContent value="vozila" className="mt-4"><VozilaTab /></TabsContent>
        <TabsContent value="ekipe" className="mt-4"><EkipeTab /></TabsContent>
      </Tabs>
    </div>
  )
}
