'use client'

// analiza-panel.tsx — R454: rezultat AI analize prizora (VLM, backend) —
// kartica pod AR predogledom (R537-b: dobesedna selitev iz ar.tsx).
// Zaprtje (setAnalysis(null)) ostane v vstopu prek propa.

import { AnimatedList, AnimatedListItem } from '@/components/roksal/motion-bits'
import { Lightbulb, X } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import type { ArAnalysis } from './tipi'

export function AnalizaPanel ({ analysis, setAnalysis }: {
  analysis: ArAnalysis
  setAnalysis: (a: ArAnalysis | null) => void
}): React.ReactElement {
  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <Lightbulb className="size-4 text-roksal-amber" aria-hidden /> AI analiza prizora
          </h2>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Zapri analizo" onClick={() => setAnalysis(null)}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        {analysis.scene ? <p className="text-sm font-medium">{analysis.scene}</p> : null}
        {analysis.placement.length > 0 ? (
          <AnimatedList className="space-y-2">
            {analysis.placement.map((p, i) => (
              <AnimatedListItem key={i} className="rounded-lg border bg-secondary/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.label}</span>
                  {p.estLenCm != null ? (
                    <Badge variant="outline" className="border-roksal-amber/40 text-roksal-amber-text">
                      ≈ {(p.estLenCm / 100).toFixed(1).replace('.', ',')} m
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-muted-foreground">{p.where}</p>
                {p.note ? <p className="mt-1 text-xs italic text-muted-foreground">{p.note}</p> : null}
              </AnimatedListItem>
            ))}
          </AnimatedList>
        ) : null}
        {analysis.obstacles.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ovire</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {analysis.obstacles.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          </div>
        ) : null}
        {analysis.references.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference za oceno mer</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {analysis.references.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Predlogi so pomoč pri odločitvi — veljavne mere vedno preverite z izmero.
        </p>
      </CardContent>
    </Card>
  )
}
