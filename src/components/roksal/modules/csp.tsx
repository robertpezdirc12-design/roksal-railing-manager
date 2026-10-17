'use client'

// CSP POROČILA — R545: pregled kršitev Content-Security-Policy v aplikaciji.
// Zavihek v sekciji Varnost (vrata: security.read = ADMIN — enako kot seje).
//
// Celotna zanka (R536 → R543 → R545):
//  • brskalnik pošlje poročilo na javno točko POST /api/csp-report (shramba
//    CspReport, R543);
//  • ta zavihek pokaže kaj/ kje / kako pogosto (GET /api/csp-reports);
//  • job csp-gc briše poročila starejša od 7 dni (TTL — diagnostika, ne
//    poslovni podatek);
//  • ko je opazovalno obdobje čisto (0 resničnih kršitev), lahko lastnik
//    preklopi CSP_MODE=enforce (config/ENV-VARS.md) — ta odločitev je NJEGOVA,
//    aplikacija jo le omogoča z vidljivimi podatki.
//
// Poštenost UI: Report-Only način NE blokira ničesar — poročila so opozorila,
// ne napake. Prazna tabela je DOBRO stanje, ne praznina brez pomena.

import { useState } from 'react'
import { Activity, Ban, FileWarning, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { apiDelete, fmtDateTime, useApi } from '@/lib/api-client'
import { EmptyState, ErrorBox, LoadingRows, PageHeader } from '@/components/roksal/ui-bits'

// ── Tipi (odgovor GET /api/csp-reports) ─────────────────────────────────────

interface CspRow {
  id: string
  documentUri: string
  violatedDirective: string
  blockedUri: string | null
  userAgent: string | null
  createdAt: string
}

interface CspResponse {
  mode: 'report' | 'enforce'
  summary: {
    total: number
    last24h: number
    last7d: number
    byDirective: { directive: string; count: number }[]
    topDocuments: { documentUri: string; count: number }[]
  }
  data: CspRow[]
}

/** userAgent je dolg — pokaži bistven del (brskalnik/OS), celoten v title. */
function kratkiAgent (ua: string | null): string {
  if (!ua) return '—'
  const del = ua.slice(0, 60)
  return ua.length > 60 ? `${del}…` : del
}

export default function CspModule () {
  const { toast } = useToast()
  const [limit, setLimit] = useState(100)
  const [cistim, setCistim] = useState(false)
  const resp = useApi<CspResponse>(`/api/csp-reports?limit=${limit}`, [limit])
  const s = resp.data?.summary
  const rows = resp.data?.data ?? []

  async function pocistiVse () {
    if (!window.confirm('Počistim VSA poročila o CSP kršitvah? So diagnostika z 7-dnevnim TTL — izpis v revizijskem dnevniku ostane.')) return
    setCistim(true)
    try {
      const r = await apiDelete<{ data: { deleted: number } }>('/api/csp-reports')
      toast({ title: `Počiščeno (${r.data.deleted} poročil).` })
      resp.reload()
    } catch (e) {
      toast({ title: 'Brisanje ni uspelo.', description: e instanceof Error ? e.message : undefined, variant: 'destructive' })
    } finally {
      setCistim(false)
    }
  }

  const prvaDirektiva = s?.byDirective[0]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Poročila o kršitvah CSP"
        desc={
          resp.data
            ? resp.data.mode === 'enforce'
              ? 'Politika je v načinu ENFORCE — kršitve se blokirajo in poročajo.'
              : 'Politika je v načinu REPORT-ONLY (opazovalno obdobje) — kršitve se poročajo, ne blokirajo. Čisto obdobje je znak za preklop v Enforce (CSP_MODE, glej config/ENV-VARS.md).'
            : 'Poročila brskalnika o kršitvah Content-Security-Policy (R543 shramba, R545 pregled).'
        }
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => resp.reload()} disabled={resp.loading}>
              <RefreshCw className={resp.loading ? 'mr-2 h-4 w-4 animate-spin' : 'mr-2 h-4 w-4'} /> Osveži
            </Button>
            <Button variant="outline" size="sm" onClick={pocistiVse} disabled={cistim || resp.loading || !s || s.total === 0}>
              <Trash2 className="mr-2 h-4 w-4" /> {cistim ? 'Čistim…' : 'Počisti vse'}
            </Button>
          </>
        )}
      />

      <ErrorBox error={resp.error} />
      {resp.loading && !resp.data ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          {/* ── povzetek ── */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardDescription>Skupno (TTL 7 dni)</CardDescription><CardTitle className="text-2xl">{s?.total ?? 0}</CardTitle></CardHeader>
              <CardContent />
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Zadnjih 24 ur</CardDescription><CardTitle className="text-2xl">{s?.last24h ?? 0}</CardTitle></CardHeader>
              <CardContent />
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardDescription>Zadnjih 7 dni</CardDescription><CardTitle className="text-2xl">{s?.last7d ?? 0}</CardTitle></CardHeader>
              <CardContent />
            </Card>
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardDescription>Najpogostejša direktiva</CardDescription>
                <CardTitle className="truncate text-lg" title={prvaDirektiva?.directive}>
                  {prvaDirektiva ? `${prvaDirektiva.directive} (${prvaDirektiva.count})` : '—'}
                </CardTitle>
              </CardHeader>
              <CardContent />
            </Card>
          </div>

          {/* ── razčlenba ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Ban className="h-4 w-4" /> Po direktivah</CardTitle>
                <CardDescription>Katera pravila politike se največkrat sprožijo.</CardDescription>
              </CardHeader>
              <CardContent>
                {s && s.byDirective.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {s.byDirective.map((d) => (
                      <Badge key={d.directive} variant="secondary" title={`${d.count}×`}>{d.directive} · {d.count}×</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Ni kršitev — politika je čista.</p>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><FileWarning className="h-4 w-4" /> Najpogostejše strani</CardTitle>
                <CardDescription>Kje (document-uri) se kršitve dogajajo.</CardDescription>
              </CardHeader>
              <CardContent>
                {s && s.topDocuments.length > 0 ? (
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                    {s.topDocuments.map((d) => (
                      <li key={d.documentUri} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d.documentUri}>{d.documentUri}</span>
                        <Badge variant="outline" className="shrink-0">{d.count}×</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Ni kršitev — politika je čista.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── tabela zadnjih ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Zadnja poročila</CardTitle>
              <CardDescription>
                Največ {limit} zadnjih. Poročila starejša od 7 dni samodejno pobriše job csp-gc (dnevno ob 03:30).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {resp.loading && rows.length === 0 ? (
                <LoadingRows rows={4} />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="0 kršitev — opazovalno obdobje je čisto"
                  desc="Brskalniki niso poročali o nobeni kršitvi politike. To je znak, da je preklop v način Enforce (CSP_MODE=enforce) varen."
                />
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-36">Čas</TableHead>
                        <TableHead className="w-40">Direktiva</TableHead>
                        <TableHead>Blokirano</TableHead>
                        <TableHead>Stran</TableHead>
                        <TableHead className="hidden md:table-cell">Brskalnik</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</TableCell>
                          <TableCell><Badge variant="secondary" className="max-w-[10rem] truncate" title={r.violatedDirective}>{r.violatedDirective}</Badge></TableCell>
                          <TableCell className="max-w-[14rem] truncate font-mono text-xs" title={r.blockedUri ?? ''}>{r.blockedUri ?? '—'}</TableCell>
                          <TableCell className="max-w-[14rem] truncate font-mono text-xs" title={r.documentUri}>{r.documentUri}</TableCell>
                          <TableCell className="hidden max-w-[12rem] truncate text-xs md:table-cell" title={r.userAgent ?? ''}>{kratkiAgent(r.userAgent)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Prikazanih: {rows.length}{s && s.total > rows.length ? ` od ${s.total}` : ''}</span>
                {limit < 200 && s && s.total > rows.length ? (
                  <button type="button" className="underline underline-offset-2" onClick={() => setLimit(200)}>Pokaži več (do 200)</button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
