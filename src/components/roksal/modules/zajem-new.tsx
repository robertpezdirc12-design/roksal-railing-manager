'use client'

// ZAJEM — nov zajem (vodena ruta) — R547 izvleček iz zajem.tsx (razbitje
// srednjih modulov po vzorcu R546; BREZ spremembe obnašanja).
// ProjectOption/RunOption živita tu (uporablja ju samo ta dialog).

import { useMemo, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiPost, useApi } from '@/lib/api-client'
import { OUTDOOR_CONDITIONS, TIER_LABELS } from '@/lib/capture-qa-engine'

export interface ProjectOption { id: string; code: string; title: string }
export interface RunOption { id: string; name: string; status: string; totalLengthCm: number; segmentCount: number }

// ─── Nov zajem ──────────────────────────────────────────────────────────────

export function NewSessionDialog ({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { toast } = useToast()
  const projects = useApi<{ data: ProjectOption[] }>('/api/projects', [])
  const [projectId, setProjectId] = useState('')
  const [mode, setMode] = useState<'FENCE_RUN' | 'KAMERA'>('FENCE_RUN')
  const [fenceRunId, setFenceRunId] = useState('')
  const [name, setName] = useState('')
  const [caps, setCaps] = useState<Record<string, boolean>>({ camera: true, gyro: true, gps: true })
  const [conditions, setConditions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const runs = useApi<{ data: RunOption[] }>(projectId ? `/api/fence-run?projectId=${projectId}` : null, [projectId])

  const tier = useMemo(() => {
    if ((caps.lidar || caps.depth) && caps.ar && caps.camera) return 'PREMIUM'
    if (caps.ar && caps.camera) return 'STANDARD'
    return 'BASIC'
  }, [caps])

  async function submit () {
    if (!projectId) { toast({ title: 'Izberite projekt' }); return }
    if (mode === 'FENCE_RUN' && !fenceRunId) { toast({ title: 'Izberite tekač', description: 'Zajem FENCE_RUN je vezan na ograjni tekač.' }); return }
    setSaving(true)
    try {
      const res = await apiPost<{ data: { id: string } }>('/api/capture-session', {
        projectId, mode, fenceRunId: mode === 'FENCE_RUN' ? fenceRunId : undefined,
        name: name || undefined,
        device: { tier, caps },
        outdoor: { conditions },
      })
      toast({ title: 'Zajem ustvarjen', description: `Režim naprave: ${tier}` })
      onCreated(res.data.id)
    } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[min(560px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-5 w-5" />Nov zajem (vodena ruta)</DialogTitle>
          <DialogDescription>
            Ruta izhaja iz geometrije tekača — pokritost, reference in drift se preverjajo sproti (§2).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Projekt *</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setFenceRunId('') }}>
              <SelectTrigger><SelectValue placeholder="Izberite projekt" /></SelectTrigger>
              <SelectContent>
                {(projects.data?.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Način</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'FENCE_RUN' | 'KAMERA')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FENCE_RUN">FENCE_RUN — nad ograjnim tekačem (priporočeno)</SelectItem>
                <SelectItem value="KAMERA">KAMERA — splošni objekt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === 'FENCE_RUN' && (
            <div className="grid gap-2">
              <Label>Tekač *</Label>
              <Select value={fenceRunId} onValueChange={setFenceRunId}>
                <SelectTrigger><SelectValue placeholder={runs.loading ? 'Nalagam…' : 'Izberite tekač'} /></SelectTrigger>
                <SelectContent>
                  {(runs.data?.data ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {(r.totalLengthCm / 100).toFixed(1)} m · {r.segmentCount} seg ({r.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Ime (neobvezno)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="npr. Zajem vhodne ograje" />
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Zmožnosti naprave (§15)</p>
            <p className="text-xs text-muted-foreground">Izbrani režim: <span className="font-semibold">{tier}</span> — {TIER_LABELS[tier as keyof typeof TIER_LABELS]}</p>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              {([['camera', 'Kamera'], ['lidar', 'LiDAR'], ['depth', 'Depth'], ['ar', 'AR tracking'], ['gyro', 'Giroskop'], ['gps', 'GPS']] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox checked={caps[k] === true} onCheckedChange={(v) => setCaps((c) => ({ ...c, [k]: v === true }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Zunanji pogoji (§16)</p>
            <div className="flex flex-wrap gap-1.5">
              {OUTDOOR_CONDITIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setConditions((xs) => xs.includes(c.id) ? xs.filter((x) => x !== c.id) : [...xs, c.id])}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${conditions.includes(c.id) ? 'border-orange-400 bg-orange-100 text-orange-900' : 'bg-background hover:bg-muted'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Prekliči</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Začni zajem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
