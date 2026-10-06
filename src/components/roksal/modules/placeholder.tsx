'use client'

// ModulePlaceholder — POŠTENA ŠKOLJKA (R429 §4: NE fake napredek)
// Modul je načrtovan po evidence iz blueprinta, implementacija sledi.

import { Construction } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { tabById } from '@/lib/nav-registry'

export function ModulePlaceholder ({ tabId, plan }: { tabId: string; plan: string[] }) {
  const tab = tabById(tabId)
  return (
    <Card>
      <CardContent className="p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-secondary">
            <Construction className="size-7 text-roksal-amber" aria-hidden />
          </div>
          <h2 className="text-lg font-bold text-foreground">{tab?.label ?? tabId}</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">{tab?.desc}</p>
          <Badge variant="secondary" className="mt-3 border-dashed">V rekonstrukciji</Badge>
          <div className="mt-6 w-full max-w-lg rounded-xl border border-dashed bg-secondary/40 p-4 text-left">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Načrt po evidence</div>
            <ul className="space-y-1.5 text-sm text-foreground/80">
              {plan.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-0.5 shrink-0 text-roksal-amber" aria-hidden>▸</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-4 text-xs text-muted-foreground/70">
            Repozitorij: gitlab.com/markec-group/roksal-railing-manager (veja rekonstrukcija)
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
