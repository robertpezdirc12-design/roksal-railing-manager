'use client'

// ZAJEM — Geo/registracija/loop panel (R462 — issue #17 §1–§5) — R547 izvleček
// iz zajem.tsx (razbitje srednjih modulov po vzorcu R546; BREZ spremembe obnašanja).

import { useEffect, useState } from 'react'
import { Compass, Plus, RefreshCw } from '@/components/roksal/custom-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { apiGet, apiPost } from '@/lib/api-client'
import {
  GEO_SOURCES, GEO_TIERS, LOOP_STATUSES, REG_QUALITY, RTK_NOT_PRODUCTION,
  effectiveAccuracy, rtkQuality,
} from '@/lib/reality-r2p-engine'

// ─── Geo/registracija/loop panel (R462 — issue #17 §1–§5) ──────────────────

export interface GeoCtx {
  geoRefs: {
    id: string; code: string; tier: string; lat: number; lon: number; altM: number | null
    atCm: number | null; coordinateSystem: string; datum: string | null
    hAccM: number | null; vAccM: number | null; source: string; rtkStatus: string | null
    correctionAgeSec: number | null; device: string | null; status: string; note: string | null
  }[]
  registrations: { id: string; version: number; quality: string; rmsCm: number; transform: { tx?: number; ty?: number; rotationDeg?: number; scale?: number; orientation?: string } | null; createdAt: string }[]
  loops: { id: string; status: string; positionDiffCm: number; heightDiffCm: number | null; startCode: string; endCode: string; createdAt: string }[]
}

export function GeoPanel ({ sessionId, zaklenjen, mayWrite, onReload }: {
  sessionId: string
  zaklenjen: boolean
  mayWrite: boolean
  onReload: () => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [geo, setGeo] = useState<GeoCtx | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await apiGet<{ data: GeoCtx }>(`/api/capture-session/${sessionId}/geo-reference`)
        if (alive) setGeo(r.data)
      } catch { /* 404 brez geo — prazno */ }
    }
    void load()
    return () => { alive = false }
  }, [sessionId, busy])

  // forma georeference
  const [tier, setTier] = useState<'BASIC' | 'PROFESSIONAL' | 'SURVEY'>('PROFESSIONAL')
  const [source, setSource] = useState('MARKER')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [altM, setAltM] = useState('')
  const [atCm, setAtCm] = useState('')
  const [hAccM, setHAccM] = useState('')
  const [rtk, setRtk] = useState<'FIX' | 'FLOAT' | 'NONE'>('FIX')
  const [corrAge, setCorrAge] = useState('')

  // forma registracije
  const [regPts, setRegPts] = useState('')
  const [regNote, setRegNote] = useState('')

  // forma loop
  const [loopStart, setLoopStart] = useState('')
  const [loopEnd, setLoopEnd] = useState('')
  const [loopExpected, setLoopExpected] = useState('')
  const [loopMeasured, setLoopMeasured] = useState('')

  async function act (fn: () => Promise<void>) {
    setBusy(true)
    try { await fn() } catch (e) {
      toast({ title: 'Napaka', description: (e as Error).message, variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function addGeo () {
    await act(async () => {
      const la = parseFloat(lat)
      const lo = parseFloat(lon)
      if (!Number.isFinite(la) || !Number.isFinite(lo)) { toast({ title: 'Neveljavna lat/lon' }); return }
      const body: Record<string, unknown> = { tier, source, lat: la, lon: lo }
      const alt = parseFloat(altM); if (Number.isFinite(alt)) body.altM = alt
      const at = parseFloat(atCm); if (Number.isFinite(at) && at >= 0) body.atCm = at
      const ha = parseFloat(hAccM); if (Number.isFinite(ha) && ha > 0) body.hAccM = ha
      const srcDef = GEO_SOURCES.find((s) => s.id === source)
      if (srcDef?.rtk) body.rtkStatus = rtk
      const ca = parseFloat(corrAge); if (Number.isFinite(ca) && ca >= 0) body.correctionAgeSec = ca
      const r = await apiPost<{ data: { code: string; capped: boolean; accuracyReason: string; rtkUsable: boolean; rtkReason: string } }>(`/api/capture-session/${sessionId}/geo-reference`, body)
      toast({
        title: `Georeferenca ${r.data.code} dodana`,
        description: `${r.data.capped ? '⚠ Natančnost omejena na vir — ' : ''}${r.data.rtkUsable ? r.data.rtkReason : '⚠ ' + r.data.rtkReason}`,
      })
      setLat(''); setLon(''); setAltM(''); setAtCm(''); setHAccM(''); setCorrAge('')
      onReload()
    })
  }

  async function register () {
    await act(async () => {
      let pts: unknown
      try { pts = JSON.parse(regPts) } catch { toast({ title: 'Točke niso veljaven JSON' }); return }
      const r = await apiPost<{ data: { version: number; quality: string; rmsCm: number | null; reasons: string[] } }>(`/api/capture-session/${sessionId}/register`, { points: pts, note: regNote || undefined })
      const q = REG_QUALITY[r.data.quality as keyof typeof REG_QUALITY]
      toast({
        title: `Registracija v${r.data.version}: ${q?.label ?? r.data.quality}`,
        description: `RMS ${r.data.rmsCm != null ? r.data.rmsCm.toFixed(2) : '—'} cm${r.data.reasons.length > 0 ? ' · ' + r.data.reasons[0] : ''}`,
        variant: r.data.quality === 'INVALID' ? 'destructive' : 'default',
      })
      setRegPts(''); setRegNote('')
      onReload()
    })
  }

  async function loopCheck () {
    await act(async () => {
      const ex = parseFloat(loopExpected)
      const me = parseFloat(loopMeasured)
      if (!Number.isFinite(ex) || !Number.isFinite(me)) { toast({ title: 'Neveljavne razdalje' }); return }
      const r = await apiPost<{ data: { status: string; positionDiffCm: number; reasons: string[] } }>(`/api/capture-session/${sessionId}/loop`, {
        startCode: loopStart || 'START', endCode: loopEnd || 'REF-001',
        expectedCm: ex, measuredCm: me,
      })
      const ls = LOOP_STATUSES[r.data.status as keyof typeof LOOP_STATUSES]
      toast({
        title: ls?.label ?? r.data.status,
        description: `Odmik ${r.data.positionDiffCm.toFixed(1)} cm — ${r.data.reasons[0] ?? ''}`,
        variant: r.data.status === 'LOOP_FAILED' ? 'destructive' : 'default',
      })
      setLoopExpected(''); setLoopMeasured('')
      onReload()
    })
  }

  const srcDef = GEO_SOURCES.find((s) => s.id === source)
  const accPreview = effectiveAccuracy(source, parseFloat(hAccM) || undefined)
  const rtkPreview = srcDef?.rtk ? rtkQuality(rtk, parseFloat(corrAge) || undefined) : null
  const lastReg = geo?.registrations[0]
  const lastLoop = geo?.loops[0]

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <p className="flex items-center gap-2 font-medium"><Compass className="h-4 w-4" />Georeferenca · registracija · loop (R462)</p>

        {/* georeference */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Georeference (§1/§2) — {geo?.geoRefs.length ?? 0}</p>
          {geo && geo.geoRefs.length > 0 && (
            <div className="space-y-1">
              {geo.geoRefs.map((g) => {
                const rq = rtkQuality(g.rtkStatus, g.correctionAgeSec)
                return (
                  <div key={g.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                    <Badge variant="outline">{g.code}</Badge>
                    <span className="text-muted-foreground">
                      {g.tier} · {g.lat.toFixed(6)}, {g.lon.toFixed(6)}{g.altM != null ? `, ${g.altM.toFixed(1)} m` : ''}
                      {g.atCm != null ? ` · @ ${(g.atCm / 100).toFixed(1)} m` : ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ±{((g.hAccM ?? 0) * 100).toFixed(1)} cm
                    </span>
                    {g.rtkStatus && (
                      <Badge variant="outline" className={g.rtkStatus === 'FIX' ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-800'}>
                        RTK {g.rtkStatus}{!rq.usable ? ' ⚠' : ''}
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {mayWrite && !zaklenjen && (
            <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Nivo</Label>
                <Select value={tier} onValueChange={(v) => setTier(v as 'BASIC' | 'PROFESSIONAL' | 'SURVEY')}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(GEO_TIERS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vir</Label>
                <Select value={source} onValueChange={(v) => { setSource(v); if (GEO_SOURCES.find((s) => s.id === v)?.rtk) setRtk('FIX') }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GEO_SOURCES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label} (≤{(s.hAccCapM * 100).toFixed(1)} cm)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {srcDef?.rtk && (
                <div className="space-y-1">
                  <Label className="text-xs">RTK status</Label>
                  <Select value={rtk} onValueChange={(v) => setRtk(v as 'FIX' | 'FLOAT' | 'NONE')}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIX">FIX</SelectItem>
                      <SelectItem value="FLOAT">FLOAT</SelectItem>
                      <SelectItem value="NONE">NONE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Latitude</Label>
                <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="46.056946" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Longitude</Label>
                <Input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" placeholder="14.505751" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">N. višina (m)</Label>
                <Input value={altM} onChange={(e) => setAltM(e.target.value)} inputMode="decimal" placeholder="312.4" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">@ položaj (cm)</Label>
                <Input value={atCm} onChange={(e) => setAtCm(e.target.value)} inputMode="decimal" placeholder="250" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Zaht. natanč. (m)</Label>
                <Input value={hAccM} onChange={(e) => setHAccM(e.target.value)} inputMode="decimal" placeholder="0.01" />
              </div>
              {srcDef?.rtk && (
                <div className="space-y-1">
                  <Label className="text-xs">Starost korekcij (s)</Label>
                  <Input value={corrAge} onChange={(e) => setCorrAge(e.target.value)} inputMode="decimal" placeholder="12" />
                </div>
              )}
              <div className="sm:col-span-3">
                <p className="text-xs text-muted-foreground">
                  Učinkovita natančnost: ±{(accPreview.hAccM * 100).toFixed(1)} cm{accPreview.capped ? ' (OMEJENO na vir — ' + accPreview.reason + ')' : ''}
                  {rtkPreview && !rtkPreview.usable ? ` · ⚠ ${rtkPreview.reason}` : ''}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{RTK_NOT_PRODUCTION}</p>
                <Button size="sm" className="mt-2" onClick={addGeo} disabled={busy}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Dodaj georeferenco
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* registracija */}
        <div className="space-y-2">
          <p className="text-sm font-medium">3-točkovna registracija (§3)</p>
          {lastReg && (
            <div className={`rounded-md border px-2.5 py-1.5 text-sm ${REG_QUALITY[lastReg.quality as keyof typeof REG_QUALITY]?.cls ?? ''}`}>
              v{lastReg.version}: {REG_QUALITY[lastReg.quality as keyof typeof REG_QUALITY]?.label ?? lastReg.quality}
              {' '}· RMS {lastReg.rmsCm.toFixed(2)} cm
              {lastReg.transform && ` · rot ${(lastReg.transform.rotationDeg ?? 0).toFixed(2)}° · merilo ${(lastReg.transform.scale ?? 1).toFixed(3)}`}
            </div>
          )}
          {mayWrite && !zaklenjen && (
            <div className="space-y-2 rounded-lg border p-3">
              <Label className="text-xs">Točke source→target (JSON, 3 točke)</Label>
              <textarea
                className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-xs"
                value={regPts}
                onChange={(e) => setRegPts(e.target.value)}
                placeholder={'[{"code":"GEO-001","source":{"x":0,"y":0},"target":{"x":100,"y":50}},\n {"code":"GEO-002","source":{"x":300,"y":15},"target":{"x":402,"y":63}},\n {"code":"GEO-003","source":{"x":600,"y":30},"target":{"x":703,"y":77}}]'}
              />
              <div className="flex gap-2">
                <Input value={regNote} onChange={(e) => setRegNote(e.target.value)} placeholder="opomba (neobvezno)" />
                <Button size="sm" onClick={register} disabled={busy}><Compass className="mr-1 h-3.5 w-3.5" />Registriraj</Button>
              </div>
            </div>
          )}
        </div>

        {/* loop closure */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Loop closure (§5)</p>
          {lastLoop && (
            <div className={`rounded-md border px-2.5 py-1.5 text-sm ${LOOP_STATUSES[lastLoop.status as keyof typeof LOOP_STATUSES]?.cls ?? ''}`}>
              {LOOP_STATUSES[lastLoop.status as keyof typeof LOOP_STATUSES]?.label ?? lastLoop.status}
              {' '}· {lastLoop.startCode} → {lastLoop.endCode} · odmik {lastLoop.positionDiffCm.toFixed(1)} cm
            </div>
          )}
          {mayWrite && !zaklenjen && (
            <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Start ref</Label>
                <Input value={loopStart} onChange={(e) => setLoopStart(e.target.value)} placeholder="START" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Konec ref</Label>
                <Input value={loopEnd} onChange={(e) => setLoopEnd(e.target.value)} placeholder="REF-001" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Po teku (cm)</Label>
                <Input value={loopExpected} onChange={(e) => setLoopExpected(e.target.value)} inputMode="decimal" placeholder="500" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Merilo (cm)</Label>
                <div className="flex gap-2">
                  <Input value={loopMeasured} onChange={(e) => setLoopMeasured(e.target.value)} inputMode="decimal" placeholder="501.5" />
                  <Button size="sm" onClick={loopCheck} disabled={busy}><RefreshCw className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
