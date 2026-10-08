import { NextRequest, NextResponse } from 'next/server'
import { jsonError, requirePermission } from '@/lib/auth'
import { progressForProject } from '@/lib/project-progress'

// /api/projects/[id]/progress — R456 (issue #11 §3/§10): POSLOVNI TOK PROJEKTA.
// GET (projects.read) → 13-stopenjski napredek
//   POVPRAŠEVANJE → STRANKA → IZMERA → KONFIGURACIJA → BOM → PONUDBA → PODPIS
//   → REZERVACIJA → DOSTAVA → MONTAŽA → PREDAJA → RAČUN → GARANCIJA
// + naslednji korak (prva nedokončana stopnja) z akcijo in ciljnim zavihkom.
// Namenska rut­a (ne razširitev podrobnosti) — en vir izračuna za podrobnost
// projekta in ploščo »Naslednji koraki« na Preglednici.

type Params = { params: Promise<{ id: string }> }

export async function GET (req: NextRequest, { params }: Params) {
  const auth = await requirePermission(req, 'projects.read')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const progress = await progressForProject(id)
  if (!progress) return jsonError(404, 'Projekt ne obstaja.')

  return NextResponse.json({ data: progress })
}
