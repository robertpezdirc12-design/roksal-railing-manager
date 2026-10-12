// /api/guide — R490 (GitHub issue #11 §5/§6): SMART GUIDE servisni vpogled.
// GET (prijava — katera koli vloga):
//   - integriteta registra (validateGuide: manjkajoči prevodi SL/HR,
//     neveljavni sketchKey, dupliciteni/prazni ID-ji, neznan tabId),
//   - kazalo vnosov po modulih (id, tabId, title SL/HR, sketchKey, version),
//   - skladnost SKETCH_KEYS (register) ↔ SKETCH_COMPONENT_KEYS (komponente).
// Vsebina pomoči NI občutljiva, a je dostop za prijavljene (enako kot
// ostale interne rutne). Avtomatski test tests/r490.py se veže na ta
// odgovor — integracijska točka za CI (issue #11 §6).

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, jsonError } from '@/lib/auth'
import { GUIDE, SKETCH_KEYS, validateGuide } from '@/lib/smart-guide-registry'

export async function GET (req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return jsonError(401, 'Ni prijave.', 'Za pregled pomoči je potrebna prijava.')

  const issues = validateGuide()
  return NextResponse.json({
    data: {
      stevilo: GUIDE.length,
      veljavno: issues.length === 0,
      issues,
      sketchKeys: SKETCH_KEYS,
      vnosi: GUIDE.map((g) => ({
        id: g.id,
        tabId: g.tabId,
        titleSl: g.title[0],
        titleHr: g.title[1],
        steps: g.steps.length,
        sketchKey: g.sketchKey,
        version: g.version,
        firstUse: g.firstUse
      }))
    }
  })
}
