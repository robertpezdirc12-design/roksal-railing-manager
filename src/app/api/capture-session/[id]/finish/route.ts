// /api/capture-session/[id]/finish — zaključek zajema z VRATI (R461 — issue #16 §1/§7/§9/§26)
// POST { obstojeco? } (measurements.write) → vsa vrata morajo pasti:
//   1. pokritost: vse kritične cone ustrezno zajete (§1)
//   2. vodena ruta: obvezni koraki opravljeni (KALIBRACIJA/COVERAGE, §2)
//   3. reference: ≥ 1 aktivna, 0 konfliktov, dodatna ref ob slabih pogojih (§4/§16)
//   4. drift: ne RE_LOC_REQUIRED (§3)
// Uspeh → ZAKLJUCEN + AS-MEASURED digital twin snapshot v1+ (§9) + reviziji.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requirePermission } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { captureSessionZaUporabnika } from '@/lib/capture-qa-access'
import { analyzeSession, finishCaptureSession, loadCaptureContext } from '@/lib/capture-qa-service'
import { deliverEvent, recordEvent } from '@/lib/notify'
import { retryOnUnique } from '@/lib/versioning'

export async function POST (req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(req, 'measurements.write')
  if (auth instanceof NextResponse) return auth
  const { user } = auth
  const { id } = await params

  const access = await captureSessionZaUporabnika(user, id)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({}))
  const obstojeco = body && typeof body === 'object' && typeof (body as { obstojeco?: unknown }).obstojeco === 'string'
    ? (body as { obstojeco: string }).obstojeco.trim().slice(0, 500) || null
    : null

  const ctx = await loadCaptureContext(id)
  if (!ctx) return jsonError(404, 'Zajem ne obstaja.')

  if (ctx.session.status === 'ZAKLJUCEN') {
    return jsonError(409, 'Zajem je že zaključen.', `Snapshot: ${ctx.session.snapshotId ?? '—'}`)
  }

  // R539 (transakcijska celovitost): criticalGate za revizijo/odgovor je
  // determinističen iz ctx (tekač se pri zaključku NE spreminja) — analiza
  // teče PRED transakcijo, ker analyzeSession persistira pokritost/drift prek
  // globalnega db (ne more teči znotraj odprte tx nad istim zajemom —
  // zaklenjena vrstica bi pomenila blokado).
  const analysis = await analyzeSession(ctx)

  // R539: zaključek zajema (status ZAKLJUCEN + AS-MEASURED snapshot + verzija
  // — finishCaptureSession na tx klientu) + OBE reviziji (CAPTURE_FINISH +
  // TWIN_SNAPSHOT_CREATE) + zapis dogodka CAPTURE_PROCESSED (outbox) v ENI
  // $transaction. retryOnUnique okoli CELE transakcije: verzija snapshot-a je
  // read-then-create (@@unique([projectId, kind, version])) — sočasen zaključek
  // povzroči P2002, ki v PG transakciji aborta CELO tx (neobnovljiv, R536),
  // zunanji ponovni poskus verzijo izračuna znova. Neuspešna vrata (ok:false)
  // NE ustvarijo napake tx — callback se vrne brez pisanja in prazna tx se brez
  // škode potrdi; obstoječa semantika 409 ostaja nespremenjena.
  const { result, recorded } = await retryOnUnique(() => db.$transaction(async (tx) => {
    const result = await finishCaptureSession(ctx, user.id, obstojeco, tx)
    if (!result.ok) return { result, recorded: null }

    await writeAudit({
      userId: user.id,
      action: 'CAPTURE_FINISH',
      entity: 'captureSession',
      entityId: id,
      projectId: access.session.projectId,
      detail: {
        name: access.session.name,
        snapshotId: result.snapshotId,
        version: result.version,
        ...(analysis?.criticalGate ? { gate: analysis.criticalGate } : {}),
      },
    }, tx)
    await writeAudit({
      userId: user.id,
      action: 'TWIN_SNAPSHOT_CREATE',
      entity: 'digitalTwinSnapshot',
      entityId: result.snapshotId as string,
      projectId: access.session.projectId,
      detail: { kind: 'AS_MEASURED', version: result.version, reason: 'Zaključek zajema' },
    }, tx)

    // R481 (issue #9 §9 — „zajem obdelan"): dogodek ob zaključku obdelave
    // zajema (IN_APP pisarni + webhook dostava) — ZAPIS v isti transakciji
    // (transakcijski outbox, R537), dostava PO commitu. Ključ vključuje
    // snapshotId (deterministično — ponoven klic ne podvoji).
    const recorded = await recordEvent({
      type: 'CAPTURE_PROCESSED',
      key: `capture-processed:${id}:${result.snapshotId}`,
      title: 'Zajem obdelan',
      body: `Zajem ${access.session.name} je obdelan — AS-MEASURED snapshot v${result.version} (${access.session.mode}).`,
      projectId: access.session.projectId,
      audience: 'OFFICE',
    }, tx)
    return { result, recorded }
  }))

  if (!result.ok) {
    return jsonError(409, 'Zajem ne more biti zaključen — manjkajoči pogoji.', (result.reasons ?? []).join(' '))
  }

  // dostava obvestila PO uspešnem commitu (ognjevarna — nikoli ne vrže napake)
  if (recorded) await deliverEvent(recorded)

  // kritična vrata mer se vrnejo v odgovoru (ZA PONUDBO/KONFIGURACIJO/PROIZVODNJO, §7)
  return NextResponse.json({
    data: {
      snapshotId: result.snapshotId,
      version: result.version,
      criticalGate: analysis?.criticalGate ?? null,
    },
  }, { status: 201 })
}
