'use client'

// NAGIB — kalkulator nagibov stopnišč (vrata projects.read)
// kot = atan2(v, d), priporočena dolžina ograje = √(v² + d²)
// priporočila: kot > 30° → profil ALU-NAG-45
// shranjevanje kot meritve tipa NAGIB (measurements.write)

import { useMemo, useState } from 'react'
import { Loader2, Ruler, Save, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiPost, useApi } from '@/lib/api-client'
import { ErrorBox, PageHeader, StatCard } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'

const toNum = (v: string): number | null => {
  if (!v.trim()) return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

const fmt2 = (n: number) => n.toFixed(2)

export default function NagibModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()

  const [heightStr, setHeightStr] = useState('180')
  const [runStr, setRunStr] = useState('280')
  const [busy, setBusy] = useState(false)

  const canWrite = hasPerm(user?.perms, 'measurements.write')

  const calc = useMemo(() => {
    const h = toNum(heightStr)
    const d = toNum(runStr)
    if (h === null || d === null) return { h: null as number | null, d: null as number | null, angle: null, railingCm: null }
    const angle = (Math.atan2(h, d) * 180) / Math.PI
    const railingCm = Math.sqrt(h * h + d * d)
    return { h, d, angle, railingCm }
  }, [heightStr, runStr])

  const valid = calc.angle !== null && calc.railingCm !== null
  const angle = calc.angle ?? 0
  const railingCm = calc.railingCm ?? 0

  const rec = valid
    ? angle > 30
      ? { label: 'ALU-NAG-45', desc: 'Strmo stopnišče (kot > 30°) — priporočeni profil ALU-NAG-45, nagibna ograja za strme kite.', tone: 'red' as const }
      : angle > 20
        ? { label: 'ALU-NAG-30', desc: 'Zmerno strmo stopnišče (20°–30°) — primeren nagibni profil ALU-NAG-30.', tone: 'amber' as const }
        : { label: 'ALU-L-80', desc: 'Blag nagib (≤ 20°) — zadostuje ravninski ALU profil (npr. ALU-L-80).', tone: 'green' as const }
    : { label: '—', desc: 'Vnesite višino in vodoravno dolžino stopnišča.', tone: 'default' as const }

  // zadnje shranjene meritve nagiba (če ima uporabnik measurements.read)
  const canRead = hasPerm(user?.perms, 'measurements.read')
  const recent = useApi<{ data: { id: string; slopeDeg: number | null; lengthCm: number | null; note: string | null; createdAt: string; author: { name: string } | null }[] }>(
    canRead ? '/api/measurements?type=NAGIB' : null,
    [canRead]
  )

  async function save () {
    if (!valid || calc.h === null || calc.d === null || calc.angle === null || calc.railingCm === null) return
    setBusy(true)
    try {
      await apiPost('/api/measurements', {
        type: 'NAGIB',
        slopeDeg: Math.round(calc.angle * 100) / 100,
        lengthCm: Math.round(calc.railingCm * 10) / 10,
        note: `višina ${calc.h} cm / dolžina ${calc.d} cm`,
      })
      toast({
        title: 'Meritev nagiba shranjena.',
        description: `kot ${fmt2(calc.angle)}° · dolžina ograje ${(calc.railingCm / 100).toFixed(2)} m`,
      })
      await recent.reload()
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju meritve', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Nagib" desc="Kalkulator stopniščnega nagiba in priporočene dolžine ograje" />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* vnosi */}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ng-h">Višina (cm)</Label>
                <Input
                  id="ng-h" type="number" min="0" inputMode="decimal"
                  value={heightStr} onChange={(e) => setHeightStr(e.target.value)}
                  placeholder="180"
                  aria-describedby="ng-h-hint"
                />
                <p id="ng-h-hint" className="text-[11px] text-muted-foreground">skupna višina vzpona</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ng-d">Dolžina vodoravno (cm)</Label>
                <Input
                  id="ng-d" type="number" min="0" inputMode="decimal"
                  value={runStr} onChange={(e) => setRunStr(e.target.value)}
                  placeholder="280"
                  aria-describedby="ng-d-hint"
                />
                <p id="ng-d-hint" className="text-[11px] text-muted-foreground">horizontalni doseg kota</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard label="Kot nagiba" value={valid ? `${fmt2(angle)}°` : '—'} icon={TrendingUp} tone={angle > 30 ? 'red' : 'default'} />
              <StatCard label="Dolžina ograje" value={valid ? `${(railingCm / 100).toFixed(2)} m` : '—'} hint={valid ? `${fmt2(railingCm)} cm` : undefined} icon={Ruler} />
              <StatCard label="Priporočeni profil" value={rec.label} hint={valid ? `kot ${fmt2(angle)}°` : undefined} tone={rec.tone} />
            </div>

            <p className={`rounded-xl border p-3 text-sm ${angle > 30 && valid ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'bg-secondary/60 text-foreground/80'}`}>
              {rec.desc}
            </p>

            {canWrite ? (
              <Button className="w-full" onClick={() => void save()} disabled={busy || !valid}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                Shrani kot meritev
              </Button>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Za shranjevanje meritve je potrebna pravica measurements.write.
              </p>
            )}
          </CardContent>
        </Card>

        {/* shema trikotnika */}
        <Card>
          <CardContent className="p-4 sm:p-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Shema stopnišča</h2>
            <TriangleSvg
              h={calc.h ?? 180}
              d={calc.d ?? 280}
              valid={valid}
              angle={angle}
              railingCm={calc.railingCm}
            />
          </CardContent>
        </Card>
      </div>

      {/* zadnje shranjeni nagibi */}
      {canRead ? (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">Zadnji izračunani nagibi</h2>
            <ErrorBox error={recent.error} />
            {recent.loading ? (
              <p className="text-sm text-muted-foreground">Nalagam …</p>
            ) : (recent.data?.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Ni shranjenih meritev nagiba.</p>
            ) : (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {(recent.data?.data ?? []).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg border p-2.5 text-sm">
                    <span className="min-w-0">
                      <strong className="text-foreground">{m.slopeDeg != null ? `${fmt2(m.slopeDeg)}°` : '—'}</strong>
                      <span className="ml-2 text-xs text-muted-foreground">{m.note ?? ''}</span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {m.lengthCm != null ? `${(m.lengthCm / 100).toFixed(2)} m` : '—'} · {m.author?.name ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ─── SVG shema: pravokotni trikotnik z oznakami ──────────────────────────────

function TriangleSvg ({ h, d, valid, angle, railingCm }: {
  h: number; d: number; valid: boolean; angle: number; railingCm: number | null
}) {
  // merilo: prilegaj območju 280 × 150
  const scale = Math.min(280 / d, 150 / h)
  const w = d * scale
  const hh = h * scale

  const A = { x: 30, y: 190 }        // desni kot (spodaj levo)
  const B = { x: 30 + w, y: 190 }    // spodaj desno — kot α
  const C = { x: 30, y: 190 - hh }   // zgoraj levo

  // lok kota α pri B (iz 180° proti 180° − α, r = 26)
  const r = 26
  const arcPts: string[] = []
  for (let i = 0; i <= 12; i++) {
    const phi = ((180 - angle * (i / 12)) * Math.PI) / 180
    arcPts.push(`${(B.x + r * Math.cos(phi)).toFixed(1)},${(B.y - r * Math.sin(phi)).toFixed(1)}`)
  }
  const phiMid = ((180 - angle / 2) * Math.PI) / 180
  const alphaLabel = { x: B.x + (r + 16) * Math.cos(phiMid), y: B.y - (r + 16) * Math.sin(phiMid) + 4 }

  // oznaka hipotenuze (pravokotno od središča, stran od trikotnika)
  const len = Math.sqrt(w * w + hh * hh)
  const M = { x: 30 + w / 2, y: 190 - hh / 2 }
  const off = 16
  const hypLabel = { x: M.x + (off * w) / len, y: M.y - (off * hh) / len }

  return (
    <svg
      viewBox="-85 0 430 230"
      className="w-full"
      role="img"
      aria-label={`Shema stopnišča: višina ${h} cm, vodoravna dolžina ${d} cm, kot ${angle.toFixed(2)} stopinj`}
    >
      {/* kateti */}
      <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="stroke-muted-foreground" strokeWidth={2} />
      <line x1={A.x} y1={A.y} x2={C.x} y2={C.y} className="stroke-muted-foreground" strokeWidth={2} />

      {/* hipotenuza = ograja */}
      <line x1={C.x} y1={C.y} x2={B.x} y2={B.y} className="stroke-roksal-amber" strokeWidth={3.5} strokeLinecap="round" />

      {/* oznaka pravega kota */}
      <path d={`M ${A.x} ${A.y - 12} L ${A.x + 12} ${A.y - 12} L ${A.x + 12} ${A.y}`} className="stroke-muted-foreground" strokeWidth={1.5} fill="none" />

      {/* lok kota α */}
      <polyline points={arcPts.join(' ')} className="stroke-roksal-amber" strokeWidth={1.5} fill="none" />

      {/* točke */}
      <circle cx={A.x} cy={A.y} r={3} className="fill-muted-foreground" />
      <circle cx={B.x} cy={B.y} r={3} className="fill-muted-foreground" />
      <circle cx={C.x} cy={C.y} r={3} className="fill-roksal-amber" />

      {/* oznake */}
      <text x={A.x - 10} y={A.y - hh / 2} textAnchor="end" dominantBaseline="middle" className="fill-foreground text-[13px] font-semibold">
        v = {valid ? `${h} cm` : '?'}
      </text>
      <text x={A.x + w / 2} y={A.y + 20} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">
        d = {valid ? `${d} cm` : '?'}
      </text>
      <text x={alphaLabel.x} y={alphaLabel.y} textAnchor="middle" className="fill-roksal-amber text-[13px] font-bold">
        α = {valid ? `${angle.toFixed(2)}°` : '?'}
      </text>
      <text x={hypLabel.x} y={hypLabel.y} textAnchor="middle" className="fill-roksal-amber text-[12px] font-semibold">
        ograja = {valid && railingCm != null ? `${(railingCm / 100).toFixed(2)} m` : '?'}
      </text>
    </svg>
  )
}
