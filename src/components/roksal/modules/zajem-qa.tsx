'use client'

// ZAJEM — Element QA panel (R462 — issue #17 §8) — R547 izvleček iz zajem.tsx
// (razbitje srednjih modulov po vzorcu R546; BREZ spremembe obnašanja).

import { useEffect, useState } from 'react'
import { Boxes } from '@/components/roksal/custom-icons'
import { Card, CardContent } from '@/components/ui/card'
import { apiGet } from '@/lib/api-client'
import { ErrorBox } from '@/components/roksal/ui-bits'

// ─── Element QA panel (R462 — issue #17 §8) ─────────────────────────────────

export interface QaPayload {
  elements: { key: string; label: string; kind: string; state: string; messages: string[] }[]
  frames: { photoId: string; zone: string; sharpness: string; exposure: string; usableForGeometry: boolean; reason: string }[]
}

export function ElementQaPanel ({ sessionId }: { sessionId: string }) {
  const [qa, setQa] = useState<QaPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    const load = async () => {
      try {
        const r = await apiGet<{ data: QaPayload }>(`/api/capture-session/${sessionId}/qa`)
        if (alive) setQa(r.data)
      } catch (e) {
        if (alive) setError((e as Error).message)
      }
    }
    void load()
    return () => { alive = false }
  }, [sessionId])

  if (error) return <ErrorBox error={{ message: error }} />
  if (!qa) return null
  const stateCls: Record<string, string> = {
    GREEN: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    WARNING: 'bg-amber-100 text-amber-900 border-amber-300',
    RED: 'bg-red-100 text-red-800 border-red-300',
    GRAY: 'bg-gray-100 text-gray-600 border-gray-300',
  }
  const slabih = qa.frames.filter((f) => !f.usableForGeometry).length

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="flex items-center gap-2 font-medium"><Boxes className="h-4 w-4" />Element-level QA (§8) — {qa.elements.length} elementov</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {qa.elements.map((el) => (
            <div key={el.key} className={`rounded-md border px-2.5 py-1.5 text-sm ${stateCls[el.state] ?? stateCls.GRAY}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{el.label}</span>
                <span className="shrink-0 text-[10px] font-bold uppercase">{el.state === 'GREEN' ? '●' : el.state === 'WARNING' ? '▲' : el.state === 'RED' ? '■' : '○'} {el.state}</span>
              </div>
              <p className="mt-0.5 truncate text-xs opacity-80">{el.messages[0] ?? ''}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Quality posnetkov (§7): {qa.frames.length} posnetkov · {slabih} neuporabnih za geometrijo
          {slabih > 0 ? ' (označeni — »lepa fotka, neuporabna za geometrijo«)' : ''}
        </p>
      </CardContent>
    </Card>
  )
}
