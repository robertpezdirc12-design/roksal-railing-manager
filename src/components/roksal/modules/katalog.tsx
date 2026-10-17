'use client'

// KATALOG — produktni model po družinah (R442, issue #7 P0)
// Zavihka: IZDELKI (družine → izdelki → podrobnost z BOM predlogo + kalkulatorjem)
// in CENIKI (PriceList/PriceRule — poslovne cene NISO hardcoded).
// R448 (§11): hitri filter po družini na Izdelkih — vodoravno drseče tablete
// s preslikavo ProductFamily.code v slovenska imena.
// Profile (stari railing katalog) ostaja v /api/catalog za konfigurator/viz.
// R548: razbitje po vzorcu R546/R547 — lupina drži zavihke, gradniki živijo v
// katalog-{shared,izdelki,ceniki,gradiva}.

import { useState } from 'react'
import { BadgeJapaneseYen, Shapes } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/roksal/ui-bits'
import { ProductsTab } from './katalog-izdelki'
import { PriceListsTab } from './katalog-ceniki'

// ─── glavni modul ────────────────────────────────────────────────────────────

export default function KatalogModule () {
  const [tab, setTab] = useState('izdelki')
  return (
    <div className="space-y-4">
      <PageHeader
        title="Katalog"
        desc="Produktni model po družinah — izdelki, variante, BOM predloge in ceniki"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="izdelki"><Shapes className="mr-1.5 size-4" aria-hidden /> Izdelki</TabsTrigger>
          <TabsTrigger value="ceniki"><BadgeJapaneseYen className="mr-1.5 size-4" aria-hidden /> Ceniki</TabsTrigger>
        </TabsList>
        <TabsContent value="izdelki" className="mt-4">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="ceniki" className="mt-4">
          <PriceListsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
