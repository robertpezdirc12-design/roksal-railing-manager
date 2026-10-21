'use client'

// VIZ — 3D konfigurator + parametrična SVG risba ograje (vrata projects.read v nav-registry)
// R436 (GitLab issue #1): tip ograje (OGRAJA/BALUSTRADA/NAGIB), dimenzije iz meritev,
// materiali iz kataloga, barve RAL, izračun cene + ponudba (POST /api/quotes),
// 3D pogled (viz-3d.tsx — lastna perspektivna projekcija) in 2D tehnična risba
// (tloris + stranski pogled, merilo 1:1, izvoz SVG) — ohranjeni.
// Shranjevanje kot meritev (measurements.write) zdaj nosi params.konfigurator.
// R464 (GitHub issue #1): izračun cene NI VEČ klienten — teče strežniško
// (POST /api/price-lists/calculate → product-core calcKonfigCena) iz cenikov
// (PriceRule KONFIG:* pravila + Profile.pricePerM); UI samo prikaže rezultat.
// R548: razbitje po vzorcu R546/R547 — stanjski del konfiguratorja ostaja tu
// (kohezivne closures; nadaljnja delitev ne bi bila bajtno-identična), risalno
// jedro živi v viz-risanje.tsx, skupni tipi v viz-shared.ts.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Box, Copy, Download, FilePlus2, FolderOpen, Loader2, Orbit, Ruler, Save, Sigma, Trash2 } from '@/components/roksal/custom-icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store'
import { ApiError, apiDelete, apiPost, fmtEUR, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'
import { hasPerm } from '@/lib/permissions-core'
import {
  RAL_COLORS, Railing3D, TIP_LABELS, TIP_SHORT, fmtM, fmtQty,
  isColorId, parseKonfigurator, ralLabel,
  type ColorId, type KonfigTip,
} from './viz-3d'
import { type CenaRezultat, type MeasurementRow, type ProfileRow, type ProjectRow, type VizRow, toNum } from './viz-shared'
import { RailingSvg } from './viz-risanje'


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
        // R542: params je jsonb objekt (zod sprejema samo objekt)
        params: {
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
        },
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

  // ── R464 (issue #1): izračun cene iz cenika — strežniško (debounce 300 ms) ──
  // Vhodi konfiguracije se pošljejo na POST /api/price-lists/calculate; pricing
  // core razreši cene iz aktivnega cenika (PriceRule KONFIG:*) in kataloga
  // profilov (Profile.pricePerM). V UI NIČ poslovnih cen in formul.
  const [cena, setCena] = useState<CenaRezultat | null>(null)
  const [cenaBusy, setCenaBusy] = useState(false)
  const [cenaError, setCenaError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      setCenaBusy(true)
      apiPost<{ data: CenaRezultat }>('/api/price-lists/calculate', {
        tip,
        lengthCm: Math.round(lengthCm * 10) / 10,
        heightCm: Math.round(heightCm),
        posts,
        handrail,
        montaza,
        profileId: profile?.id ?? null,
        colorLabel: color.label,
      })
        .then((res) => {
          if (!alive) return
          setCena(res.data)
          setCenaError(null)
        })
        .catch((e: unknown) => {
          if (!alive) return
          setCena(null)
          setCenaError(e instanceof ApiError || e instanceof Error ? e.message : 'Izračun cene ni uspel.')
        })
        .finally(() => { if (alive) setCenaBusy(false) })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [tip, lengthCm, heightCm, posts, handrail, montaza, profile?.id, color.label])

  const montazaLabel = cena?.unitPrices.MONTAZA != null
    ? `Montaža (${fmtEUR(cena.unitPrices.MONTAZA)}/m)`
    : 'Montaža'

  async function ustvariPonudbo (): Promise<void> {
    if (!cena) return
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
   *  kot params.konfigurator pri meritvi, plus segments/montaza/location).
   *  R542: params je jsonb OBJEKT (zod sprejema samo objekt). */
  function currentParams (): Record<string, unknown> {
    return {
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
    }
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
    // R542: params je jsonb objekt (API ga vrača razčlenjenega) — brez JSON.parse
    const k = row.params
    if (!k || typeof k !== 'object') {
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
                        {m.type} · {(m.lengthCm ?? 0) / 100} m{m.location ? ` · ${m.location}` : ''}{(typeof m.params === 'string' ? m.params : JSON.stringify(m.params ?? '')).includes('"konfigurator"') ? ' · 3D' : ''}
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

        {/* izračun (povezava konfiguracije s ponudbo) — R464: strežniško iz cenika */}
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
              <Sigma className="size-4 text-roksal-amber" aria-hidden /> Izračun
            </h2>
            {cenaError ? (
              <ErrorBox error={{ message: cenaError }} />
            ) : !cena ? (
              cenaBusy ? (
                <LoadingRows rows={3} />
              ) : (
                <EmptyState title="Izračun ni na voljo" desc="Preverite vnosne parametre in poskusite znova." icon={Sigma} />
              )
            ) : (
              <>
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
                  <span className="flex items-center gap-2">
                    {cenaBusy ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
                    <span className="text-lg font-bold tabular-nums text-roksal-amber">{fmtEUR(cena.skupaj)}</span>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Ocena iz konfiguracije — vir: {cena.priceSource} · DDV 22 % se obračuna v ponudbi.
                </p>
              </>
            )}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor="viz-montaza" className="cursor-pointer">{montazaLabel}</Label>
              <Switch id="viz-montaza" checked={montaza} onCheckedChange={setMontaza} />
            </div>
            {canQuote ? (
              <Button className="w-full" onClick={() => void ustvariPonudbo()} disabled={quoteBusy || !cena}>
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
