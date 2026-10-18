'use client'

// faza-potrditev.tsx — FAZA 5: POTRDITEV: povzetek z veljavnostjo po količinah
// (R500), konflikt pogledov kot VRATA potrditve (R487 §4C), ročni popravek
// dolžine z razlogom (R455 §1), POST /api/measurement/confirm (R455 razširjeno)
// in offline shranjevanje v vrsto (R439 issue #6).
// R537-a: dobesedna selitev iz meritve-kamera.tsx — skupno stanje pride prek
// propsov; zapisiDokSlike/confirm/saveOffline so krajevni (živijo le tu).

import type { Dispatch, RefObject, SetStateAction } from 'react'
import { Check, CloudUpload, Loader2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { apiPost } from '@/lib/api-client'
import { clearDraft } from '@/lib/measure-draft'
import type { DokSlika } from '@/lib/measure-doc'
import {
  MEASUREMENT_STATUS_LABELS, MODE_RULES, measurementStatusAllowsBusiness,
  type AnalyzeResult, type CalibrationMethod, type MeasureMode, type MeasurementStatus,
} from '@/lib/measure-engine'
import { queuePhoto } from '@/lib/offline'
import { useAppStore } from '@/lib/store'
import { fmt1, type CalcResult, type MultiView } from './geometrija'
import { KOLICINA_LABEL, KOLICINA_STATE_LABEL, type View, type ZgodovinaVnos } from './tipi'

export interface FazaPotrditevProps {
  view: View
  views: View[]
  calc: CalcResult
  multi: MultiView
  analysis: AnalyzeResult | null
  mode: MeasureMode
  type: string
  setType: Dispatch<SetStateAction<string>>
  stairMode: boolean
  heightS: string
  setHeightS: Dispatch<SetStateAction<string>>
  note: string
  setNote: Dispatch<SetStateAction<string>>
  overrideOn: boolean
  setOverrideOn: Dispatch<SetStateAction<boolean>>
  overrideLen: string
  setOverrideLen: Dispatch<SetStateAction<string>>
  overrideReason: string
  setOverrideReason: Dispatch<SetStateAction<string>>
  location: string
  projectId: string
  workOrderId: string
  calibMethod: CalibrationMethod
  refObject: string
  finalLengthCm: number | null
  conflictBlocked: boolean
  online: boolean
  busy: boolean
  setBusy: Dispatch<SetStateAction<boolean>>
  setSavedId: Dispatch<SetStateAction<string | null>>
  detajli: DokSlika[]
  setViews: Dispatch<SetStateAction<View[]>>
  setAnalysis: Dispatch<SetStateAction<AnalyzeResult | null>>
  setServerLayout: Dispatch<SetStateAction<string | null>>
  setPhase: Dispatch<SetStateAction<1 | 2 | 3 | 4 | 5>>
  resetAll: () => void
  osnutekKljuc: () => string
  osveziShranjevanje: () => void
  onSaved: () => void | Promise<void>
  onClose: () => void
  past: RefObject<ZgodovinaVnos[]>
  future: RefObject<ZgodovinaVnos[]>
  uploadPhoto: (namen?: 'KALIBRACIJA' | 'POTRDITEV') => Promise<void>
  rocnoCnt: number
}

export function FazaPotrditev (props: FazaPotrditevProps) {
  const {
    view, views, calc, multi, analysis, mode, type, setType, stairMode, heightS, setHeightS, note,
    setNote, overrideOn, setOverrideOn, overrideLen, setOverrideLen, overrideReason, setOverrideReason,
    location, projectId, workOrderId, calibMethod, refObject, finalLengthCm, conflictBlocked, online,
    busy, setBusy, setSavedId, detajli, setViews, setAnalysis, setServerLayout, setPhase, resetAll,
    osnutekKljuc, osveziShranjevanje, onSaved, onClose, past, future, uploadPhoto, rocnoCnt,
  } = props
  const { toast } = useToast()

  /** R522: shrani vse dokumentacijske slike kot FOTO zapise, vezane na
   *  POTRJENO meritev (docOf). Poštenost: napaka ene slike NE požre uspeha
   *  meritve (issue #7 §6) — pove se, koliko je uspelo. */
  async function zapisiDokSlike (meritevId: string): Promise<void> {
    if (detajli.length === 0) return
    let uspeh = 0
    for (const d of detajli) {
      try {
        await apiPost('/api/measurements', {
          type: 'FOTO',
          projectId: projectId !== 'none' ? projectId : null,
          workOrderId: workOrderId !== 'none' ? workOrderId : null,
          location: location.trim() || null,
          // R542: params je jsonb objekt (zod sprejema samo objekt)
          params: { photo: d.dataUrl, stage: 'DOKUMENTACIJA' },
          docOfMeasurementId: meritevId,
          docTag: d.tag,
          docSegmentIdx: d.segmentIdx,
          docNote: d.note || null,
        })
        uspeh += 1
      } catch {
        // slika ostane v seznamu (monter vidi, kaj manjka) — brez ustavljanja
      }
    }
    if (uspeh === detajli.length) {
      toast({ title: `Shranjenih ${uspeh} dokumentacijskih slik.`, description: 'Vsaka je vezana na potrjeno meritev (oznaka detajla + segment + opomba).' })
    } else {
      toast({ title: `Shranjenih ${uspeh} od ${detajli.length} dokumentacijskih slik.`, description: 'Meritev JE shranjena — slike, ki niso uspele, lahko dodaš prek modula Foto z opombo.', variant: 'destructive' })
    }
  }

  /** Potrditev in shranjevanje (POST /api/measurement/confirm) — R455 razširjeno. */
  async function confirm (again: boolean): Promise<void> {
    if (!view) return
    if (finalLengthCm === null || finalLengthCm <= 0) {
      toast({ title: 'Manjka kalibracija ali točke.', description: 'Kalibrirajte merilo in označite vsaj 2 točki.', variant: 'destructive' })
      return
    }
    if (overrideOn && overrideReason.trim().length < 3) {
      toast({ title: 'Ročni popravek zahteva razlog.', description: 'Navedite razlog spremembe izračunane dolžine (sledljivost).', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await apiPost<{ data: { id: string; status?: MeasurementStatus; statusNote?: string | null } }>('/api/measurement/confirm', {
        photoId: views[0].photoId,
        type: stairMode ? 'NAGIB' : type,
        location: location.trim() || null,
        lengthCm: finalLengthCm,
        heightCm: Number(heightS.replace(',', '.')) > 0 ? Number(heightS.replace(',', '.')) : null,
        slopeDeg: calc.segs.length === 1 ? Math.round(calc.segs[0].angleDeg * 10) / 10 : null,
        posts: calc.scale.known
          ? Math.max(calc.pts.length >= 2 ? 2 : 0, calc.segs.reduce((acc, s) => acc + Math.max(1, Math.ceil((s.cmLen ?? 0) / 120)) + 1, 0) - Math.max(0, calc.segs.length - 1))
          : null,
        segments: calc.segs.length,
        note: note.trim() || (stairMode && calc.segs.length > 0 && calc.segs.every((s) => Math.abs(s.angleDeg) >= 20 && Math.abs(s.angleDeg) <= 75)
          ? `${calc.segs.length} stopnic`
          : null),
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
        points: calc.pts.map((p) => ({ x: p.x, y: p.y })),
        calibration: view.calib ? { ...view.calib, method: calibMethod, refObject: refObject.trim() || undefined, imgW: Math.round(view.imgW), imgH: Math.round(view.imgH) } : null,
        // R455: več pogledov (brez primarnega), kakovost, zaupanje, ročni popravek
        views: views.length > 1
          ? views.slice(1).map((v) => ({
            photoId: v.photoId ?? undefined,
            points: v.points.filter((p) => p.src !== 'PREDLOG').map((p) => ({ x: p.x, y: p.y })),
            calibration: v.calib ? { ...v.calib, imgW: Math.round(v.imgW), imgH: Math.round(v.imgH) } : undefined,
          }))
          : undefined,
        quality: views[0].quality
          ? {
            brightness: views[0].quality.brightness,
            blurScore: views[0].quality.blurScore,
            dark: views[0].quality.dark,
            bright: views[0].quality.bright,
            blurry: views[0].quality.blurry,
          }
          : undefined,
        confidence: multi.conf,
        manualOverride: overrideOn
          ? { computedLengthCm: multi.mean !== null && multi.lengths.length > 1 ? Math.round(multi.mean * 10) / 10 : (calc.totalCm !== null ? Math.round(calc.totalCm * 10) / 10 : 0), reason: overrideReason.trim() }
          : undefined,
        // R457 (issue #12): način izmere + rezultat engine-a (§2, §7)
        mode,
        engine: analysis
          ? {
            domain: analysis.domain,
            validation: analysis.validation,
            confidence: analysis.confidence,
            // R500 (issue #15 faza 1): model merila + veljavnost po quantities
            // gresta v zapis, da revizija vidi, KAJ je bila dokazana mera.
            scale: analysis.scale,
            validity: analysis.validity,
          }
          : undefined,
      })
      setSavedId(res.data.id)
      // R522: dokumentacijske slike gredo ZA meritvijo (docOf = njen id) —
      // napake posamezne slike ne rušijo meritve.
      await zapisiDokSlike(res.data.id)
      // R501 (issue #15 faza 2): o poslovni meri odloči STREŽNIK — monterju
      // pokažemo njegovo stanje (in razlog), ne lastno trditev.
      const stanje = res.data.status ? MEASUREMENT_STATUS_LABELS[res.data.status] : null
      toast({
        title: 'Meritev potrjena in shranjena.',
        description: stanje
          ? `${fmt1(finalLengthCm / 100)} m · stanje: ${stanje}${measurementStatusAllowsBusiness(res.data.status) ? ' — uporabljena bo v konfiguratorju in BOM-u.' : ' — v BOM ne sme (korak: dokazano merilo ali pisarniška potrditev).'}`
          : `${fmt1(finalLengthCm / 100)} m · zaupanje ${multi.conf} % — uporabljena bo v konfiguratorju in BOM-u.`,
      })
      if (again) {
        setNote(''); setOverrideOn(false); setOverrideLen(''); setOverrideReason(''); setServerLayout(null)
        setViews((vs) => vs.map((v) => ({ ...v, points: [], calib: v.calibLocked ? v.calib : null })))
        setAnalysis(null) // R457: nova meritev na isti fotografiji → nova analiza
        past.current = []; future.current = []
        setPhase(2)
      } else {
        // R486 (issue #7 §6/§7): uspešno potrjena meritev → osnutek ni več potreben.
        // clearDraft ŠELEJ SEDAJ (meritev JE shranjena) a PRED onSaved()/resetAll() —
        // onSaved sproži reload podatkov, ob katerem se lahko dialog zapre in DANES
        // ponovno naloži osnutek; če izbris IndexedDB še ni rezultiran, bi se pokazala
        // LAŽNA pasika »Nadaljuj nedokončano« (issue #7 §7 brez lažnih stanj).
        // R508: zbriše SAMO to sejo (projekt/nalog) — druge nedokončane meritve
        // istega monterja na napravi ostanejo.
        const uid = useAppStore.getState().user?.id
        const kljuc = osnutekKljuc()
        if (uid) await clearDraft(uid, kljuc).catch(() => { /* osnutek ni kritičen */ })
        osveziShranjevanje() // R508: vrstica mora takoj povedati resnico (strežnik)
        await onSaved()
        resetAll()
      }
    } catch (e) {
      // R508 (issue #7 §6): napaka mora povedati, KAJ naj monter stori — ne le
      // surove besede strežnika ali brskalnika.
      toast({
        title: 'Meritev ni shranjena',
        description: e instanceof Error
          ? `${e.message} Nič ni izgubljenega: točke in kalibracija ostanejo v telefonu — poskusi znova ali izberi »Shrani lokalno«.`
          : 'Strežnik meritve ni dosegel. Poskusi znova ali shrani lokalno in sinhroniziraj, ko se signal vrne.',
        variant: 'destructive',
      })
    } finally { setBusy(false) }
  }

  /**
   * R439 (issue #6): offline shranjevanje — fotografija gre v IndexedDB photos
   * shrambo (kompresirana), op 'foto' pa nosi tudi merilne podatke
   * (tip/dolžina/višina/stebri/segmenti/nagib). Samodejna sinhronizacija prek
   * /api/sync ob vrnitvi signala (idempotentno — opId).
   */
  async function saveOffline (): Promise<void> {
    if (!view) return
    setBusy(true)
    try {
      await queuePhoto({
        dataUrl: view.dataUrl,
        projectId: projectId !== 'none' ? projectId : null,
        workOrderId: workOrderId !== 'none' ? workOrderId : null,
        note: note.trim() || null,
        location: location.trim() || null,
        type: stairMode ? 'NAGIB' : type,
        lengthCm: finalLengthCm !== null && finalLengthCm > 0 ? finalLengthCm : null,
        heightCm: Number(heightS.replace(',', '.')) > 0 ? Number(heightS.replace(',', '.')) : null,
        posts: null,
        segments: calc.segs.length,
        slopeDeg: calc.segs.length === 1 ? Math.round(calc.segs[0].angleDeg * 10) / 10 : null,
        // R486 (issue #7 §6 — dopolnitev offline poti): kalibracija/pogledi/kakovost/
        // zaupanje/ročni popravek/način/engine se izgubijo SAMO če jih NE pošljemo —
        // struktura je IDENTIČNA confirm (:771-819), /api/sync pa jih zapiše v params.
        points: calc.pts.map((p) => ({ x: p.x, y: p.y })),
        calibration: view.calib
          ? { ...view.calib, method: calibMethod, refObject: refObject.trim() || undefined, imgW: Math.round(view.imgW), imgH: Math.round(view.imgH) }
          : null,
        views: views.length > 1
          ? views.slice(1).map((v) => ({
            photoId: v.photoId ?? undefined,
            points: v.points.filter((p) => p.src !== 'PREDLOG').map((p) => ({ x: p.x, y: p.y })),
            calibration: v.calib ? { ...v.calib, imgW: Math.round(v.imgW), imgH: Math.round(v.imgH) } : undefined,
          }))
          : null,
        quality: views[0].quality
          ? {
            brightness: views[0].quality.brightness,
            blurScore: views[0].quality.blurScore,
            dark: views[0].quality.dark,
            bright: views[0].quality.bright,
            blurry: views[0].quality.blurry,
          }
          : null,
        confidence: multi.conf,
        manualOverride: overrideOn
          ? { computedLengthCm: multi.mean !== null && multi.lengths.length > 1 ? Math.round(multi.mean * 10) / 10 : (calc.totalCm !== null ? Math.round(calc.totalCm * 10) / 10 : 0), reason: overrideReason.trim() }
          : null,
        mode,
        engine: analysis
          ? { domain: analysis.domain, validation: analysis.validation, confidence: analysis.confidence, scale: analysis.scale, validity: analysis.validity }
          : null,
      })
      // R522: dokumentacijske slike gredo v vrsto vsaka KOT SVOJ op (vzorec
      // photos) — brez merilnih podatkov (slika ni mera). docOf ni možen
      // offline (id dodeli strežnik ob sinhronizaciji) → opFoto zapiše
      // docOffline: true, oznaka/segment/opomba pa se OHRANITA.
      for (const d of detajli) {
        try {
          await queuePhoto({
            dataUrl: d.dataUrl,
            projectId: projectId !== 'none' ? projectId : null,
            workOrderId: workOrderId !== 'none' ? workOrderId : null,
            type: 'FOTO',
            note: d.note || null,
            docTag: d.tag,
            docSegmentIdx: d.segmentIdx,
            docNote: d.note || null,
          })
        } catch {
          // ena slika ne sme izbrisati seje (§6) — poved se zapiše v toast
        }
      }
      toast({
        title: 'Shranjeno lokalno — sinhroniziralo se bo samodejno',
        description: `${finalLengthCm ? `Meritev ${fmt1(finalLengthCm / 100)} m in fotografija` : 'Fotografija'} bosta poslani, ko se signal vrne.${detajli.length > 0 ? ` Dokumentacijske slike (${detajli.length}) gredo v isti vrsti.` : ''} Ali bo številka poslovna mera ali ocena, na sinhronizaciji odloči strežnik (merilo px/cm).`,
      })
      // R508: ključ se izračuna PRED resetAll() — resetAll počisti projekt/nalog.
      const uid = useAppStore.getState().user?.id
      const kljuc = osnutekKljuc()
      osveziShranjevanje() // vrstica takoj pove »Čaka na sinhronizacijo«, ne zmolči
      resetAll()
      // R486 (issue #7 §6): offline shranjeno v vrsto → osnutek ni več potreben
      // (await — isti razlog kot v confirm: brez lažnega NADALJUJ gumba po shranjevanju)
      // R508: zbriše SAMO ta seja, druge nedokončane meritve ostanejo.
      if (uid) await clearDraft(uid, kljuc).catch(() => { /* osnutek ni kritičen */ })
      onClose()
    } catch (e) {
      // R508 (issue #7 §6): napaka pove, KAJ narediti — surov message ni napotek.
      toast({
        title: 'Meritev ni v vrsti za sinhronizacijo',
        description: e instanceof Error
          ? `${e.message} Nič ni izgubljenega — poskusi znova ali počakaj, da je signal nazaj, in potrdi meritev.`
          : 'V telefonu ni bilo prostora za zapis. Počisti zaključene zapise in poskusi znova.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2 p-3 text-sm">
              <p className="font-semibold">Povzetek meritve</p>
              <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <span>Način: <strong className="text-foreground">{MODE_RULES[mode].label}</strong></span>
                <span>Dolžina: <strong className="text-foreground">{finalLengthCm !== null ? `${fmt1(finalLengthCm / 100)} m` : '—'}</strong></span>
                <span>Segmentov: <strong className="text-foreground">{calc.segs.length}</strong></span>
                <span>Zaupanje: <strong className="text-foreground">{multi.conf} % ({multi.label}){analysis ? ` · engine ${analysis.confidence.confidence} %` : ''}</strong></span>
                <span>Pogledov: <strong className="text-foreground">{views.length}</strong></span>
                <span>Analiza engine-a: <strong className="text-foreground">{analysis ? (analysis.validation.some((i) => i.severity === 'NAPAKA') ? '⚠ napake — preveri' : '✓ opravljena') : 'ni opravljena'}</strong></span>
                <span>Fotografija: <strong className="text-foreground">{views[0].photoId ? `✓ (${rocnoCnt} točk)` : online ? 'ni shranjena' : 'shranila se bo ob sinhronizaciji'}</strong></span>
                {multi.spreadPct !== null ? <span>Razpršenost: <strong className="text-foreground">{fmt1(multi.spreadPct)} %</strong></span> : null}
              </div>
              {/* R500 (issue #15 faza 1): KAJ je dokazano — po posamezni količini.
                  Brez te vrstice bi povzetek dajal vtis, da je vsaka številka na
                  zaslonu enako zanesljiva poslovna mera. */}
              {analysis ? (
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-[11px]">
                  <p className="font-semibold text-foreground">
                    {analysis.validity.status === 'VELJAVNA'
                      ? `Merilo ${(analysis.scale.cmPerPxX ?? 0).toFixed(2).replace('.', ',')} cm/px: dokazano za merjene količine`
                      : analysis.validity.status === 'NEZADOSTNI_PODATKI'
                        ? '⚠ Podatki ne zadoščajo — številke so okvirne, ne potrjena poslovna mera'
                        : '⚠ Geometrija v neskladju — popravite točke ali kalibracijo'}
                  </p>
                  <p className="text-muted-foreground">
                    {analysis.validity.quantities.map((q) => `${KOLICINA_LABEL[q.quantity]}: ${KOLICINA_STATE_LABEL[q.state]}`).join(' · ')}
                  </p>
                  {analysis.validity.reasons.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {analysis.validity.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {!views[0].photoId && online ? (
                <Button size="sm" variant="outline" onClick={() => void uploadPhoto('POTRDITEV')} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Najprej naloži fotografijo
                </Button>
              ) : null}
              {!views[0].photoId && !online ? (
                <p className="text-[11px] text-muted-foreground">
                  Brez povezave — fotografija in meritev se shranita lokalno ter pošljeta ob sinhronizaciji.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* R487 (issue #3 §4C): konflikt pogledov — VRATA potrditve. Razhajanje
              > 5 % je VIDNO in blokira POTRDI, dokler ni rešeno (popravek
              točk/kalibracije → strinjanje, ali ročna laserska mera z razlogom). */}
          {conflictBlocked ? (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/40" role="alert">
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                ⚠ Pogledi se razlikujejo za {fmt1(multi.spreadPct ?? 0)} % — potrditev je blokirana.
              </p>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                Popravite točke ali kalibracijo na pogledih (korak Meritev), ali izrecno potrdite razhajanje: vnesite lasersko meritev z razlogom prek »Ročno popravi dolžino« spodaj.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Tip</Label>
              <Select value={type} onValueChange={setType} disabled={stairMode}>
                <SelectTrigger aria-label="Tip meritve"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OGRAJA">Ograja</SelectItem>
                  <SelectItem value="BALUSTRADA">Balustrada</SelectItem>
                  <SelectItem value="NAGIB">Nagib</SelectItem>
                  <SelectItem value="OSTANEO">Ostalo</SelectItem>
                </SelectContent>
              </Select>
              {stairMode ? <p className="text-[11px] text-muted-foreground">Stopniški način → tip NAGIB</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="km-height">Višina (cm) — izmerjena; brez vpisa ostane nepovestna</Label>
              <Input id="km-height" type="number" min="20" inputMode="numeric" placeholder="npr. 100 (brez vpisa ni vpisana)" value={heightS} onChange={(e) => setHeightS(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="km-note">Opomba</Label>
              <Input id="km-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opombe s terena …" />
            </div>
          </div>

          {/* R455: ročni popravek dolžine z obveznim razlogom (§1 — sledljivost) */}
          <Card>
            <CardContent className="space-y-2 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox" className="size-4 accent-amber-600" checked={overrideOn}
                  onChange={(e) => { setOverrideOn(e.target.checked); if (e.target.checked && !overrideLen && finalLengthCm !== null) setOverrideLen((finalLengthCm / 100).toFixed(2)) }}
                />
                Ročno popravi dolžino (npr. iz merilnega traku)
              </label>
              {overrideOn ? (
                <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
                  <div className="space-y-1">
                    <Label htmlFor="km-override" className="text-xs">Dolžina (m)</Label>
                    <Input id="km-override" type="number" min="0.1" step="any" inputMode="decimal" value={overrideLen} onChange={(e) => setOverrideLen(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="km-override-reason" className="text-xs">Razlog (obvezen — sledljivost)</Label>
                    <Input id="km-override-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="npr. izmerjeno z laserjem na kraju samem" />
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => setPhase(4)}><Undo2 className="size-4" aria-hidden /> Nazaj na preverjanje</Button>
            <div className="flex flex-wrap gap-2">
              {/* R439 (issue #6): brez signala — shrani v vrsto (foto + meritev) */}
              {!online ? (
                <Button
                  variant="outline" className="border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950"
                  onClick={() => void saveOffline()} disabled={busy || !view.dataUrl || conflictBlocked}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CloudUpload className="size-4" aria-hidden />}
                  Shrani (offline)
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void confirm(true)} disabled={busy || !views[0].photoId || finalLengthCm === null || conflictBlocked}>
                Shrani in meri naprej na isti fotografiji
              </Button>
              <Button onClick={() => void confirm(false)} disabled={busy || !views[0].photoId || finalLengthCm === null || conflictBlocked}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                Potrdi in shrani meritev
              </Button>
            </div>
          </DialogFooter>
        </div>
  )
}
