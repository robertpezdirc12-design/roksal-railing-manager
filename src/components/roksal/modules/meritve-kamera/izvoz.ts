// MERITVE S KAMERO — izvoz CSV/JSON potrjene meritve (GET
// /api/measure-engine/export). R457 (§19). Čist .ts brez Reacta.
// R537-a: selitev iz meritve-kamera.tsx (izhodiščne glave ostajajo ob kodi);
// `savedId` in `toast` prejmeta kot argumenta (lastnik stanja je vstopna
// komponenta, toast pa je stabilna modulska funkcija).

import { useAppStore } from '@/lib/store'
import type { ToastFn } from './tipi'

/** R457 (§19): prenos izvoza CSV/JSON/DXF potrjene meritve (R558: + dxf). */
export async function prenesiIzvoz (savedId: string | null, fmt: 'csv' | 'json' | 'dxf', toast: ToastFn): Promise<void> {
  if (!savedId) return
  try {
    const token = useAppStore.getState().token
    const res = await fetch(`/api/measure-engine/export?id=${savedId}&format=${fmt}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(d.error ?? `HTTP ${res.status}`)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `roksal-meritev-${savedId.slice(-8)}.${fmt}`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: `Izvoz ${fmt.toUpperCase()} prenešen.`, description: fmt === 'dxf' ? 'DXF (CAD, razviti prikaz ograje) — odpre se v AutoCAD-u, LibreCAD-u in BricsCAD-u.' : 'Dokument vsebuje projekt, reference, mere, zaupanje in verzijo.' })
  } catch (e) {
    toast({ title: 'Izvoz ni uspel', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
  }
}
