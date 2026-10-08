'use client'

// VIZ — 3D konfigurator + parametrična SVG risba ograje (vrata projects.read v nav-registry)
// R436 (GitLab issue #1): tip ograje (OGRAJA/BALUSTRADA/NAGIB), dimenzije iz meritev,
// materiali iz kataloga, barve RAL, izračun cene + ponudba (POST /api/quotes),
// 3D pogled (viz-3d.tsx — lastna perspektivna projekcija) in 2D tehnična risba
// (tloris + stranski pogled, merilo 1:1, izvoz SVG) — ohranjeni.
// Shranjevanje kot meritev (measurements.write) zdaj nosi params.konfigurator.

import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { Box, Copy, Download, FilePlus2, FolderOpen, Loader2, Orbit, Ruler, Save, Sigma, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { apiDelete, apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import {
  RAL_COLORS, Railing3D, TIP_LABELS, TIP_SHORT, fmtM, fmtQty, izracunajCeno,
  isColorId, parseKonfigurator, ralLabel,
  type ColorId, type KonfigTip,
} from './viz-3d'

// ─── konstante ───────────────────────────────────────────────────────────────

const GLASS_FILL = 'rgba(148, 163, 184, 0.28)'
const GLASS_STROKE = 'rgba(100, 116, 139, 0.55)'
const INK = '#334155'      // črte / besedilo
const INK_SOFT = '#94a3b8' // mreža
const PAPER = '#ffffff'

interface ProfileRow { id: string; sku: string; name: string; material: string; type: string; pricePerM: number }
interface ProjectRow { id: string; code: string; title: string }
interface MeasurementRow {
  id: string; type: string; location: string | null; note: string | null; params: string | null
  lengthCm: number | null; heightCm: number | null; posts: number | null
  segments: number | null; handrail: boolean | null; slopeDeg: number | null
  projectId: string | null; createdAt: string
}

/** R454: shranjen 3D projekt (GET/POST /api/viz/projects) — params = JSON konfiguratorja. */
interface VizRow {
  id: string
  name: string
  tip: string
  params: string
  note: string | null
  projectId: string | null
  createdAt: string
  updatedAt: string
  author?: { name: string; role: string } | null
  project?: { code: string; title: string } | null
}

const toNum = (v: string, fallback: number, min: number, max: number): number => {
  const n = Number(v.replace(',', '.'))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export default function VizModule () {
  const user = useAppStore((s) => s.user)
  const { toast } = useToast()
  const svgRef = useRef<SVGSVGElement>(null)
  const titleId = useId()

  const canWrite = hasPerm(user?.perms, 'measurements.write')
  const canReadMeasurements = hasPerm(user?.perms, 'measurements.read')
  const canQuote = hasPerm(user?.perms, 'quotes.create')

  // parametri
  const [profileId, setProfileId] = useState('none')
  const [lengthM, setLengthM] = useState('4')
  const [heightCmS, setHeightCmS] = useState('110')
  const [postsS, setPostsS] = useState('5')
  const [segmentsS, setSegmentsS] = useState('4')
  const [handrail, setHandrail] = useState(true)
  const [colorId, setColorId] = useState<ColorId>('antracit')
  const [tip, setTip] = useState<KonfigTip>('OGRAJA')
  const [montaza, setMontaza] = useState(true)
  const [slopeS, setSlopeS] = useState('0')
  const [projectId, setProjectId] = useState('none')
  const [location, setLocation] = useState('')
  const [fromMeasurement, setFromMeasurement] = useState('none')
  const [busy, setBusy] = useState(false)
  const [quoteBusy, setQuoteBusy] = useState(false)

  // R454: shranjeni 3D projekti (napredni 3D — vztrajnost konfiguracij)
  const [vizName, setVizName] = useState('')
  const [vizBusy, setVizBusy] = useState(false)
  const [vizRowBusy, setVizRowBusy] = useState<string | null>(null)
  const vizProjects = useApi<{ data: VizRow[] }>('/api/viz/projects', [])

  const catalog = useApi<{ data: ProfileRow[] }>('/api/catalog', [])
  const projects = useApi<{ data: ProjectRow[] }>('/api/projects', [])
  const measurements = useApi<{ data: MeasurementRow[] }>(
    canReadMeasurements ? '/api/measurements' : null,
    [canReadMeasurements]
  )

  const profiles = catalog.data?.data ?? []
  const profile = profiles.find((p) => p.id === profileId) ?? null
  const color = RAL_COLORS.find((c) => c.id === colorId) ?? RAL_COLORS[0]

  const lengthCm = toNum(lengthM, 4, 0.2, 60) * 100
  const heightCm = toNum(heightCmS, 110, 20, 400)
  const posts = Math.round(toNum(postsS, 5, 1, 40))
  const segments = Math.round(toNum(segmentsS, Math.max(1, posts - 1), 1, 40))
  const slope = toNum(slopeS, 0, 0, 60)

  const isGlass = tip === 'BALUSTRADA'

  /** Izbor profila iz kataloga hkrati predlaga tip ograje. */
  function onProfileChange (v: string): void {
    setProfileId(v)
    const p = profiles.find((r) => r.id === v) ?? null
    setTip(p?.type === 'BALUSTRADA' ? 'BALUSTRADA' : p?.type === 'NAGIBNA' ? 'NAGIB' : 'OGRAJA')
  }

  function onPostsChange (v: string): void {
    setPostsS(v)
    const n = Math.round(toNum(v, 5, 1, 40))
    setSegmentsS(String(Math.max(1, n - 1)))
  }

  function loadFromMeasurement (mid: string): void {
    setFromMeasurement(mid)
    const m = (measurements.data?.data ?? []).find((r) => r.id === mid)
    if (!m) return
    if (m.lengthCm != null) setLengthM(String(Math.round(m.lengthCm) / 100))
    if (m.heightCm != null) setHeightCmS(String(Math.round(m.heightCm)))
    if (m.posts != null && m.posts >= 1) setPostsS(String(m.posts))
    setSegmentsS(String(m.segments ?? Math.max(1, (m.posts ?? 5) - 1)))
    setHandrail(m.handrail ?? true)
    setSlopeS(m.slopeDeg != null ? String(Math.round(m.slopeDeg * 10) / 10) : '0')
    if (m.projectId) setProjectId(m.projectId)
    // izboljšava (issue #1): če meritev nosi shranjeno konfiguracijo, obnovi
    // celoten konfigurator — profil, barvo in tip, ne samo geometrijo
    const k = parseKonfigurator(m.params)
    if (k) {
      if (k.profileId) setProfileId(k.profileId)
      if (isColorId(k.colorId)) setColorId(k.colorId)
      setTip(k.tip)
      toast({
        title: 'Konfiguracija naložena.',
        description: `${k.sku ? `${k.sku} · ` : ''}${ralLabel(k.colorId)} · ${TIP_LABELS[k.tip]}`,
      })
    } else {
      toast({
        title: 'Meritev naložena.',
        description: `${m.location ?? 'Brez lokacije'} · ${(m.lengthCm ?? 0) / 100} m · ${m.heightCm ?? '—'} cm`,
      })
    }
  }

  async function save (): Promise<void> {
    setBusy(true)
    try {
      await apiPost('/api/measurements', {
        type: tip,
        lengthCm: Math.round(lengthCm * 10) / 10,
        heightCm: Math.round(heightCm),
        posts,
        segments,
        handrail,
        slopeDeg: slope > 0 ? Math.round(slope * 100) / 100 : null,
        projectId: projectId !== 'none' ? projectId : null,
        location: location.trim() || null,
        params: JSON.stringify({
          viz: { profileId: profile?.id ?? null, sku: profile?.sku ?? null, color: colorId },
          konfigurator: {
            profileId: profile?.id ?? null,
            sku: profile?.sku ?? null,
            colorId,
            tip,
            lengthCm: Math.round(lengthCm * 10) / 10,
            heightCm: Math.round(heightCm),
            posts,
            handrail,
            slopeDeg: Math.round(slope * 100) / 100,
            material: profile?.material ?? null,
          },
        }),
        note: `Konfigurator: ${profile ? `${profile.sku} · ` : ''}${color.label}${tip !== 'OGRAJA' ? ` · ${TIP_SHORT[tip]}` : ''}`,
      })
      toast({
        title: 'Konfiguracija shranjena kot meritev.',
        description: `${TIP_LABELS[tip]} · ${fmtM(lengthCm)} m × ${Math.round(heightCm)} cm · ${posts} stebrov`,
      })
    } catch (e) {
      toast({ title: 'Napaka pri shranjevanju meritve', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  function downloadSvg (): void {
    const svg = svgRef.current
    if (!svg) return
    try {
      const xml = new XMLSerializer().serializeToString(svg)
      const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vizualizacija-${profile?.sku?.toLowerCase() ?? 'ograja'}.svg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: 'SVG prenešen.', description: 'Tehnična risba (tloris + stranski pogled).' })
    } catch (e) {
      toast({ title: 'Izvoz SVG ni uspel.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    }
  }

  const measurableRows = (measurements.data?.data ?? []).filter((m) => m.lengthCm != null)

  /** Izračun cene iz trenutne konfiguracije (povezava s ponudbo). */
  const cena = izracunajCeno({
    tip,
    lengthCm,
    heightCm,
    posts,
    handrail,
    montaza,
    profile: profile ? { sku: profile.sku, name: profile.name, pricePerM: profile.pricePerM } : null,
    colorLabel: color.label,
  })

  async function ustvariPonudbo (): Promise<void> {
    setQuoteBusy(true)
    try {
      const res = await apiPost<{ data: { code: string; total: number } }>('/api/quotes', {
        projectId: projectId !== 'none' ? projectId : null,
        note: `Konfigurator: ${profile ? `${profile.sku} · ` : 'brez profila · '}${color.label}`,
        lines: cena.postavke.map((p) => ({ description: p.label, qty: p.qty, unitPrice: p.unitPrice })),
      })
      toast({
        title: 'Ponudba ustvarjena.',
        description: `${res.data.code} · skupaj z DDV ${fmtEUR(res.data.total)}`,
      })
    } catch (e) {
      toast({ title: 'Napaka pri ustvarjanju ponudbe', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setQuoteBusy(false)
    }
  }

  // ── R454: shranjeni 3D projekti (POST /api/viz/projects) ──────────────────

  /** Zapis celotne trenutne konfiguracije v params (raven format — isti ključi
   *  kot params.konfigurator pri meritvi, plus segments/montaza/location). */
  function currentParams (): string {
    return JSON.stringify({
      profileId: profile?.id ?? null,
      sku: profile?.sku ?? null,
      colorId,
      tip,
      lengthCm: Math.round(lengthCm * 10) / 10,
      heightCm: Math.round(heightCm),
      posts,
      segments,
      handrail,
      slopeDeg: Math.round(slope * 100) / 100,
      montaza,
      material: profile?.material ?? null,
    })
  }

  async function saveVizProject (): Promise<void> {
    const name = vizName.trim()
    if (!name) {
      toast({ title: 'Vnesite ime projekta.', variant: 'destructive' })
      return
    }
    setVizBusy(true)
    try {
      await apiPost('/api/viz/projects', {
        name,
        projectId: projectId !== 'none' ? projectId : null,
        tip,
        params: currentParams(),
        note: location.trim() || null,
      })
      setVizName('')
      void vizProjects.reload()
      toast({
        title: '3D projekt shranjen.',
        description: `${name} · ${TIP_LABELS[tip]} · ${fmtM(lengthCm)} m × ${Math.round(heightCm)} cm`,
      })
    } catch (e) {
      toast({ title: 'Shranjevanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setVizBusy(false)
    }
  }

  /** Naloži shranjen projekt nazaj v konfigurator (celotno stanje). */
  function loadVizProject (row: VizRow): void {
    let k: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(row.params) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) k = parsed as Record<string, unknown>
    } catch { /* neveljaven JSON — ne naložimo */ }
    if (!k) {
      toast({ title: 'Konfiguracije ni bilo mogoče prebrati.', variant: 'destructive' })
      return
    }

    if (typeof k.profileId === 'string' && profiles.some((p) => p.id === k.profileId)) setProfileId(k.profileId as string)
    if (isColorId(k.colorId)) setColorId(k.colorId)
    if (k.tip === 'BALUSTRADA' || k.tip === 'NAGIB' || k.tip === 'OGRAJA') setTip(k.tip)
    const len = Number(k.lengthCm)
    if (Number.isFinite(len) && len >= 20 && len <= 6000) setLengthM(String(Math.round(len) / 100))
    const h = Number(k.heightCm)
    if (Number.isFinite(h) && h >= 20 && h <= 400) setHeightCmS(String(Math.round(h)))
    const p = Number(k.posts)
    if (Number.isFinite(p) && p >= 1 && p <= 40) setPostsS(String(Math.round(p)))
    const sg = Number(k.segments)
    if (Number.isFinite(sg) && sg >= 1 && sg <= 40) setSegmentsS(String(Math.round(sg)))
    if (typeof k.handrail === 'boolean') setHandrail(k.handrail)
    const sl = Number(k.slopeDeg)
    if (Number.isFinite(sl) && sl >= 0 && sl <= 60) setSlopeS(String(Math.round(sl * 10) / 10))
    if (typeof k.montaza === 'boolean') setMontaza(k.montaza)
    if (typeof row.projectId === 'string' && row.projectId) setProjectId(row.projectId)

    toast({
      title: `Projekt „${row.name}" naložen.`,
      description: `${TIP_LABELS[tip]} · ${fmtM(lengthCm)} m × ${Math.round(heightCm)} cm · ${posts} stebrov`,
    })
  }

  async function duplicateVizProject (id: string): Promise<void> {
    setVizRowBusy(id)
    try {
      await apiPost(`/api/viz/projects/${id}/duplicate`)
      void vizProjects.reload()
      toast({ title: 'Projekt podvojen.', description: 'Kopija je na vrhu seznama.' })
    } catch (e) {
      toast({ title: 'Podvajanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setVizRowBusy(null)
    }
  }

  async function deleteVizProject (id: string): Promise<void> {
    setVizRowBusy(id)
    try {
      await apiDelete(`/api/viz/projects/${id}`)
      void vizProjects.reload()
      toast({ title: '3D projekt izbrisan.' })
    } catch (e) {
      toast({ title: 'Brisanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setVizRowBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vizualizacija"
        desc="3D konfigurator ograje in parametrična tehnična risba v realnem merilu"
        actions={
          <Button variant="outline" onClick={downloadSvg}>
            <Download className="size-4" aria-hidden /> Prenesi SVG
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
        {/* parametri */}
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Ruler className="size-4 text-roksal-amber" aria-hidden /> Parametri
            </h2>

            <div className="space-y-2">
              <Label htmlFor="viz-profile">Profil</Label>
              <Select value={profileId} onValueChange={onProfileChange}>
                <SelectTrigger id="viz-profile" aria-label="Profil ograje">
                  <SelectValue placeholder={catalog.loading ? 'Nalagam katalog …' : 'Brez profila'} />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">Brez profila (splošna ograja)</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErrorBox error={catalog.error} />
              {profile ? (
                <p className="text-[11px] text-muted-foreground">
                  {profile.material} · {profile.type} · {profile.pricePerM.toFixed(2).replace('.', ',')} €/m
                </p>
              ) : null}
            </div>

            {/* tip ograje (issue #1) */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Tip ograje</legend>
              <div className="grid grid-cols-3 gap-2">
                {(['OGRAJA', 'BALUSTRADA', 'NAGIB'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTip(t)}
                    aria-pressed={tip === t}
                    className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-2 text-center transition hover:border-roksal-amber/60 ${tip === t ? 'border-roksal-amber bg-amber-50 dark:bg-amber-950/30' : ''}`}
                  >
                    <span className="text-xs font-semibold">{t === 'OGRAJA' ? 'Ograja' : t === 'BALUSTRADA' ? 'Balustrada' : 'Nagib'}</span>
                    <span className="text-[10px] leading-tight text-muted-foreground">
                      {t === 'OGRAJA' ? 'navpične palice' : t === 'BALUSTRADA' ? 'steklo' : 'stopniščna'}
                    </span>
                  </button>
                ))}
              </div>
              {tip === 'NAGIB' && slope === 0 ? (
                <p className="text-[11px] text-muted-foreground">Za tip »nagib« nastavite nagib stopnišča spodaj.</p>
              ) : null}
            </fieldset>

            {canReadMeasurements ? (
              <div className="space-y-2">
                <Label htmlFor="viz-from">Naloži iz meritve</Label>
                <Select value={fromMeasurement} onValueChange={loadFromMeasurement}>
                  <SelectTrigger id="viz-from" aria-label="Naloži iz obstoječe meritve">
                    <SelectValue placeholder="Izberite meritev" />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    <SelectItem value="none">— nova risba —</SelectItem>
                    {measurableRows.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.type} · {(m.lengthCm ?? 0) / 100} m{m.location ? ` · ${m.location}` : ''}{m.params?.includes('"konfigurator"') ? ' · 3D' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ErrorBox error={measurements.error} />
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="viz-len">Dolžina (m)</Label>
                <Input id="viz-len" type="number" min="0.2" max="60" step="0.1" inputMode="decimal"
                  value={lengthM} onChange={(e) => setLengthM(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="viz-h">Višina (cm)</Label>
                <Input id="viz-h" type="number" min="20" max="400" inputMode="numeric"
                  value={heightCmS} onChange={(e) => setHeightCmS(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="viz-posts">Št. stebrov</Label>
                <Input id="viz-posts" type="number" min="1" max="40" inputMode="numeric"
                  value={postsS} onChange={(e) => onPostsChange(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="viz-segs">Št. segmentov</Label>
                <Input id="viz-segs" type="number" min="1" max="40" inputMode="numeric"
                  value={segmentsS} onChange={(e) => setSegmentsS(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="viz-slope">Nagib stopnišča (°)</Label>
                <Input id="viz-slope" type="number" min="0" max="60" step="0.5" inputMode="decimal"
                  value={slopeS} onChange={(e) => setSlopeS(e.target.value)} aria-describedby="viz-slope-hint" />
                <p id="viz-slope-hint" className="text-[11px] text-muted-foreground">0 = ravna ograja</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="viz-hand" className="cursor-pointer">Ročnik</Label>
                <Switch id="viz-hand" checked={handrail} onCheckedChange={setHandrail} />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">Barva (RAL)</legend>
              <div className="grid grid-cols-2 gap-2">
                {RAL_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setColorId(c.id)}
                    aria-pressed={colorId === c.id}
                    className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition hover:border-roksal-amber/60 ${colorId === c.id ? 'border-roksal-amber bg-amber-50 dark:bg-amber-950/30' : ''}`}
                  >
                    <span
                      aria-hidden
                      className="size-5 shrink-0 rounded-full border border-black/20"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="leading-tight">{c.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {canWrite ? (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-2">
                  <Label htmlFor="viz-project">Projekt (za shranjevanje)</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger id="viz-project" aria-label="Poveži s projektom">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-48">
                      <SelectItem value="none">Brez projekta</SelectItem>
                      {(projects.data?.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ErrorBox error={projects.error} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="viz-loc">Lokacija</Label>
                  <Input id="viz-loc" value={location} onChange={(e) => setLocation(e.target.value)}
                    placeholder="npr. Terasa — severna stran" />
                </div>
                <Button className="w-full" onClick={() => void save()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                  Shrani kot meritev
                </Button>
              </div>
            ) : (
              <p className="border-t pt-3 text-center text-xs text-muted-foreground">
                Za shranjevanje konfiguracije je potrebna pravica measurements.write.
              </p>
            )}
          </CardContent>
        </Card>

        {/* R454: shranjeni 3D projekti (napredni 3D — vztrajnost konfiguracij) */}
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <FolderOpen className="size-4 text-roksal-amber" aria-hidden /> Shranjeni 3D projekti
            </h2>

            {canWrite ? (
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="viz-name" className="sr-only">Ime projekta</Label>
                  <Input id="viz-name" value={vizName} onChange={(e) => setVizName(e.target.value)}
                    placeholder="Ime konfiguracije, npr. Terasa Kos — sever" />
                </div>
                <Button className="h-11 shrink-0" onClick={() => void saveVizProject()} disabled={vizBusy}>
                  {vizBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                  Shrani
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Za shranjevanje konfiguracij je potrebna pravica measurements.write.</p>
            )}

            {vizProjects.loading ? (
              <LoadingRows rows={3} />
            ) : vizProjects.error ? (
              <ErrorBox error={vizProjects.error} />
            ) : (vizProjects.data?.data ?? []).length === 0 ? (
              <EmptyState
                title="Ni shranjenih 3D projektov"
                desc="Konfiguracijo shranite pod imenom — naložite jo lahko kadarkoli, podvojite ali izbrišete."
              />
            ) : (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {(vizProjects.data?.data ?? []).map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {TIP_LABELS[row.tip as KonfigTip] ?? row.tip} · {row.project ? `${row.project.code} · ` : ''}
                        {new Date(row.updatedAt).toLocaleDateString('sl-SI')}
                        {row.author ? ` · ${row.author.name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" className="h-9" onClick={() => loadVizProject(row)}>
                        <FolderOpen className="size-4" aria-hidden /> Naloži
                      </Button>
                      {canWrite ? (
                        <>
                          <Button variant="ghost" size="icon" className="size-9" aria-label={`Podvoji ${row.name}`}
                            onClick={() => void duplicateVizProject(row.id)} disabled={vizRowBusy === row.id}>
                            {vizRowBusy === row.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                          </Button>
                          <Button variant="ghost" size="icon" className="size-9 text-destructive hover:text-destructive"
                            aria-label={`Izbriši ${row.name}`} onClick={() => void deleteVizProject(row.id)} disabled={vizRowBusy === row.id}>
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* izračun (povezava konfiguracije s ponudbo) */}
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Sigma className="size-4 text-roksal-amber" aria-hidden /> Izračun
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8">Postavka</TableHead>
                  <TableHead className="h-8 text-right">Količina</TableHead>
                  <TableHead className="h-8 text-right">Cena</TableHead>
                  <TableHead className="h-8 text-right">Skupaj</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cena.postavke.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell className="py-1.5 text-xs">{p.label}</TableCell>
                    <TableCell className="py-1.5 text-right text-xs whitespace-nowrap tabular-nums">{fmtQty(p.qty)} {p.qtyUnit}</TableCell>
                    <TableCell className="py-1.5 text-right text-xs whitespace-nowrap tabular-nums">{fmtEUR(p.unitPrice)}</TableCell>
                    <TableCell className="py-1.5 text-right text-xs font-medium whitespace-nowrap tabular-nums">{fmtEUR(p.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-sm font-semibold">Skupaj (brez DDV)</span>
              <span className="text-lg font-bold tabular-nums text-roksal-amber">{fmtEUR(cena.skupaj)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Ocena iz konfiguracije — DDV 22 % se obračuna v ponudbi.</p>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor="viz-montaza" className="cursor-pointer">Montaža (35 €/m)</Label>
              <Switch id="viz-montaza" checked={montaza} onCheckedChange={setMontaza} />
            </div>
            {canQuote ? (
              <Button className="w-full" onClick={() => void ustvariPonudbo()} disabled={quoteBusy}>
                {quoteBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FilePlus2 className="size-4" aria-hidden />}
                Ustvari ponudbo iz konfiguracije
              </Button>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Ustvarjanje ponudb zahteva pravico quotes.create.
              </p>
            )}
          </CardContent>
        </Card>
        </div>

        <div className="min-w-0 space-y-4">
        {/* 3D konfigurator */}
        <Card>
          <CardContent className="p-4 sm:p-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Orbit className="size-4 text-roksal-amber" aria-hidden /> 3D konfigurator
            </h2>
            {lengthCm <= 20 ? (
              <EmptyState title="Vnesite smiselne parametre" desc="Dolžina vsaj 0,2 m in višina vsaj 20 cm." icon={Orbit} />
            ) : (
              <Railing3D
                lengthCm={lengthCm}
                heightCm={heightCm}
                posts={posts}
                handrail={handrail}
                slopeDeg={slope}
                colorHex={color.hex}
                tip={tip}
                sku={profile?.sku ?? null}
              />
            )}
          </CardContent>
        </Card>

        {/* risba */}
        <Card>
          <CardContent className="p-4 sm:p-6">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Box className="size-4 text-roksal-amber" aria-hidden /> Tehnična risba
            </h2>
            {lengthCm <= 20 ? (
              <EmptyState title="Vnesite smiselne parametre" desc="Dolžina vsaj 0,2 m in višina vsaj 20 cm." icon={Sigma} />
            ) : (
              <RailingSvg
                ref={svgRef}
                titleId={titleId}
                lengthCm={lengthCm}
                heightCm={heightCm}
                posts={posts}
                handrail={handrail}
                slopeDeg={slope}
                colorHex={color.hex}
                glass={isGlass}
                sku={profile?.sku ?? null}
                profileName={profile?.name ?? null}
                colorLabel={color.label}
              />
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  )
}

// ─── SVG risba ───────────────────────────────────────────────────────────────

interface RailingSvgProps {
  lengthCm: number
  heightCm: number
  posts: number
  handrail: boolean
  slopeDeg: number
  colorHex: string
  glass: boolean
  sku: string | null
  profileName: string | null
  colorLabel: string
  titleId: string
}

function RailingSvg (props: RailingSvgProps & { ref?: Ref<SVGSVGElement> }) {
  const { ref, titleId } = props
  const geo = useMemo(() => computeGeometry(props), [props])

  const postsX = geo.postsX
  const x0 = geo.x0
  const x1 = geo.x1
  const groundY = geo.groundY
  const pxH = geo.pxH
  const slope = props.slopeDeg

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${geo.VW} ${geo.VH}`}
      className="w-full"
      role="img"
      aria-label={`Risba ograje: dolžina ${fmtM(props.lengthCm)} m, višina ${Math.round(props.heightCm)} cm, ${props.posts} stebrov`}
    >
      <title id={titleId}>Vizualizacija ograje — tloris in stranski pogled</title>

      {/* platno */}
      <rect x="0" y="0" width={geo.VW} height={geo.VH} fill={PAPER} />
      <rect x="4" y="4" width={geo.VW - 8} height={geo.VH - 8} fill="none" stroke="#e2e8f0" strokeWidth="2" rx="10" />

      {/* ── TLORIS ── */}
      <text x="28" y="34" fontSize="15" fontWeight="700" fill={INK}>Tloris</text>
      <PlanView geo={geo} colorHex={props.colorHex} glass={props.glass} />

      {/* dimenzija dolžine */}
      <DimLine x1={x0} x2={x1} y={geo.planDimY} label={`${fmtM(props.lengthCm)} m`} />

      {/* ── STRANSKI POGLED ── */}
      <text x="28" y={geo.elevTitleY} fontSize="15" fontWeight="700" fill={INK}>Stranski pogled</text>

      {/* mreža 50 cm */}
      <GridLines geo={geo} />

      {/* tla */}
      <line x1={geo.gridX0 - 16} y1={groundY} x2={geo.gridX1 + 16} y2={groundY} stroke={INK} strokeWidth="2.5" />

      {/* ograja (rotirana pri nagibu) */}
      <g transform={slope > 0 ? `rotate(${-slope} ${x0} ${groundY})` : undefined}>
        {/* polnilo segmentov */}
        {postsX.slice(0, -1).map((px, i) => {
          const nx = postsX[i + 1]
          const w = nx - px - geo.postW - 4
          if (w <= 2) return null
          const fillTop = groundY - pxH + (props.handrail ? 16 : 6)
          const fillBot = groundY - 8
          if (props.glass) {
            return (
              <rect
                key={`seg-${i}`} x={px + geo.postW / 2 + 2} y={fillTop}
                width={w} height={fillBot - fillTop}
                fill={GLASS_FILL} stroke={GLASS_STROKE} strokeWidth="1"
              />
            )
          }
          // navpični palice — razmak ~12 cm
          const paleGap = Math.max(6, geo.pxPerCm * 12)
          const paleCount = Math.max(2, Math.floor(w / paleGap))
          const paleW = Math.max(2, Math.min(5, geo.pxPerCm * 2))
          return (
            <g key={`seg-${i}`}>
              {Array.from({ length: paleCount }).map((_, j) => {
                const pxx = px + geo.postW / 2 + 4 + (j * (w - paleW)) / Math.max(1, paleCount - 1)
                return <rect key={j} x={pxx} y={fillTop} width={paleW} height={fillBot - fillTop} fill={props.colorHex} opacity="0.9" rx="1" />
              })}
            </g>
          )
        })}

        {/* srednja palica */}
        {props.handrail ? (
          <rect x={x0 - 4} y={groundY - pxH * 0.55} width={x1 - x0 + 8} height={Math.max(4, geo.pxPerCm * 3)} fill={props.colorHex} rx="2" />
        ) : null}

        {/* stebri */}
        {postsX.map((px, i) => (
          <rect key={`post-${i}`} x={px} y={groundY - pxH} width={geo.postW} height={pxH} fill={props.colorHex} rx="1.5" />
        ))}

        {/* ročnik */}
        {props.handrail ? (
          <rect x={x0 - 6} y={groundY - pxH - 10} width={x1 - x0 + 12} height={Math.max(6, geo.pxPerCm * 4)} fill={props.colorHex} rx="3" />
        ) : null}
      </g>

      {/* dimenzija višine */}
      <DimLineV x={geo.dimVX} y1={groundY - pxH - (props.handrail ? 14 : 4)} y2={groundY} label={`${Math.round(props.heightCm)} cm`} />

      {/* kot nagiba */}
      {slope > 0 ? (
        <g>
          <path
            d={`M ${x0 + 44} ${groundY} A 44 44 0 0 0 ${x0 + 44 * Math.cos((slope * Math.PI) / 180)} ${groundY - 44 * Math.sin((slope * Math.PI) / 180)}`}
            fill="none" stroke="#b45309" strokeWidth="1.5"
          />
          <text x={x0 + 54} y={groundY - 12} fontSize="12" fontWeight="700" fill="#b45309">
            {slope.toFixed(1).replace('.', ',')}°
          </text>
        </g>
      ) : null}

      {/* naslovni blok */}
      <g>
        <rect x={geo.VW - 330} y={geo.VH - 74} width="300" height="58" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
        <text x={geo.VW - 316} y={geo.VH - 54} fontSize="12" fontWeight="700" fill={INK}>
          {props.sku ? `${props.sku} · ${props.profileName ?? ''}` : 'Ograja po meri'}
        </text>
        <text x={geo.VW - 316} y={geo.VH - 36} fontSize="11" fill={INK}>
          {fmtM(props.lengthCm)} m × {Math.round(props.heightCm)} cm · {props.posts} stebrov{props.handrail ? ' · ročnik' : ''}
        </text>
        <text x={geo.VW - 316} y={geo.VH - 20} fontSize="11" fill={INK}>Barva: {props.colorLabel}</text>
      </g>

      {/* merilo */}
      <g>
        <rect x="28" y={geo.VH - 60} width={geo.scaleBarPx} height="8" fill="#0f172a" />
        <rect x="28" y={geo.VH - 60} width={geo.scaleBarPx / 2} height="8" fill="#ffffff" stroke="#0f172a" strokeWidth="1" />
        <text x="28" y={geo.VH - 66} fontSize="11" fill={INK}>Merilo: {geo.scaleLabel}</text>
      </g>
    </svg>
  )
}

// ─── geometrija ──────────────────────────────────────────────────────────────

interface Geo {
  VW: number; VH: number
  x0: number; x1: number; pxLen: number; postW: number
  planBandY: number; planBandH: number; planDimY: number
  elevTitleY: number; groundY: number; pxH: number
  gridX0: number; gridX1: number; gridStep: number
  dimVX: number; pxPerCm: number; postsX: number[]
  scaleBarPx: number; scaleLabel: string
}

function computeGeometry (p: RailingSvgProps): Geo {
  const VW = 860
  const VH = 720
  const x0 = 90
  const availW = VW - 90 - 60 // 710
  const availH = 300          // prostor za višino v elevaciji
  const pxPerCm = Math.min(availW / p.lengthCm, availH / p.heightCm)
  const pxLen = p.lengthCm * pxPerCm
  const x1 = x0 + pxLen
  const postW = Math.max(5, Math.min(14, pxPerCm * 8))
  const pxH = p.heightCm * pxPerCm

  const n = Math.max(1, p.posts)
  const postsX = n === 1
    ? [x0]
    : Array.from({ length: n }, (_, i) => x0 + (i * pxLen) / (n - 1) - postW / 2)

  const planBandY = 120
  const planBandH = 44
  const planDimY = planBandY + planBandH + 44
  const elevTitleY = planDimY + 58
  const groundY = elevTitleY + 26 + pxH

  // mreža: 50 cm
  const gridStep = pxPerCm * 50
  const gridX0 = x0
  const gridX1 = x1

  const scaleBarPx = Math.max(60, Math.min(220, pxPerCm * 100))
  const scaleLabel = `1 px = ${(1 / pxPerCm).toFixed(2).replace('.', ',')} cm · trak = ${fmtM(scaleBarPx / pxPerCm)} m`

  return {
    VW, VH, x0, x1, pxLen, postW,
    planBandY, planBandH, planDimY,
    elevTitleY, groundY, pxH,
    gridX0, gridX1, gridStep,
    dimVX: x0 - 34, pxPerCm, postsX,
    scaleBarPx, scaleLabel,
  }
}

// ─── delci risbe ─────────────────────────────────────────────────────────────

function PlanView ({ geo, colorHex, glass }: { geo: Geo; colorHex: string; glass: boolean }) {
  const bandY = geo.planBandY
  const bandH = geo.planBandH
  const midY = bandY + bandH / 2
  const posts = geo.postsX
  const x0 = geo.x0
  const x1 = geo.x1

  return (
    <g>
      {/* banda ograje */}
      <rect x={x0} y={bandY} width={geo.pxLen} height={bandH} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
      {/* polnilo segmentov (tloris) */}
      {posts.slice(0, -1).map((px, i) => {
        const nx = posts[i + 1]
        const w = nx - px - geo.postW - 4
        if (w <= 2) return null
        if (glass) {
          return <rect key={`pg-${i}`} x={px + geo.postW / 2 + 2} y={bandY + 8} width={w} height={bandH - 16} fill={GLASS_FILL} stroke={GLASS_STROKE} strokeWidth="0.8" />
        }
        return <line key={`pg-${i}`} x1={px + geo.postW / 2 + 3} y1={midY} x2={nx + geo.postW / 2 - 3} y2={midY} stroke={colorHex} strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      })}
      {/* stebri */}
      {posts.map((px, i) => (
        <rect key={`pp-${i}`} x={px} y={midY - geo.postW / 2} width={geo.postW} height={geo.postW} fill={colorHex} stroke="#1f293722" rx="1" />
      ))}
      {/* središčna os */}
      <line x1={x0} y1={midY} x2={x1} y2={midY} stroke="#cbd5e1" strokeWidth="0.6" strokeDasharray="6 4" />
    </g>
  )
}

function GridLines ({ geo }: { geo: Geo }) {
  const lines: ReactNode[] = []
  const topY = geo.elevTitleY + 18
  const bottomY = geo.groundY
  if (geo.gridStep < 8) return null // pregosto — izpusti
  for (let x = geo.gridX0, i = 0; x <= geo.gridX1 + 0.1; x += geo.gridStep, i++) {
    lines.push(<line key={`gx-${i}`} x1={x} y1={topY} x2={x} y2={bottomY} stroke={INK_SOFT} strokeWidth="0.5" opacity="0.35" />)
  }
  for (let y = bottomY, j = 0; y >= topY; y -= geo.gridStep, j++) {
    lines.push(<line key={`gy-${j}`} x1={geo.gridX0} y1={y} x2={geo.gridX1} y2={y} stroke={INK_SOFT} strokeWidth="0.5" opacity="0.35" />)
  }
  // oznaka mreže
  lines.push(
    <text key="grid-label" x={geo.gridX0} y={topY - 4} fontSize="10" fill={INK_SOFT}>
      mreža = 50 cm
    </text>
  )
  return <g>{lines}</g>
}

function DimLine ({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  const mid = (x1 + x2) / 2
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={INK} strokeWidth="1" />
      <line x1={x1} y1={y - 8} x2={x1} y2={y + 8} stroke={INK} strokeWidth="1" />
      <line x1={x2} y1={y - 8} x2={x2} y2={y + 8} stroke={INK} strokeWidth="1" />
      <polygon points={`${x1},${y} ${x1 + 8},${y - 3.5} ${x1 + 8},${y + 3.5}`} fill={INK} />
      <polygon points={`${x2},${y} ${x2 - 8},${y - 3.5} ${x2 - 8},${y + 3.5}`} fill={INK} />
      <rect x={mid - 34} y={y - 20} width="68" height="16" fill={PAPER} />
      <text x={mid} y={y - 8} fontSize="13" fontWeight="700" fill={INK} textAnchor="middle">{label}</text>
    </g>
  )
}

function DimLineV ({ x, y1, y2, label }: { x: number; y1: number; y2: number; label: string }) {
  const mid = (y1 + y2) / 2
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={INK} strokeWidth="1" />
      <line x1={x - 8} y1={y1} x2={x + 8} y2={y1} stroke={INK} strokeWidth="1" />
      <line x1={x - 8} y1={y2} x2={x + 8} y2={y2} stroke={INK} strokeWidth="1" />
      <polygon points={`${x},${y1} ${x - 3.5},${y1 + 8} ${x + 3.5},${y1 + 8}`} fill={INK} />
      <polygon points={`${x},${y2} ${x - 3.5},${y2 - 8} ${x + 3.5},${y2 - 8}`} fill={INK} />
      <rect x={x - 4} y={mid - 24} width="52" height="16" fill={PAPER} />
      <text x={x + 4} y={mid - 12} fontSize="12" fontWeight="700" fill={INK}>{label}</text>
    </g>
  )
}
