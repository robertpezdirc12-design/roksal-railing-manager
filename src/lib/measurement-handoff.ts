// R509 (issue #7 §8 — pisarniška veriga): prenos POTRJENE kamerne meritve v
// paket projekta (status IZMERA), da pisarna ne vnaša meritev znova (§21).
//
// MODUL JE NAMENOMA ČIST (brez Prisma, brez DOM-a): odločitev KDAJ smemo paket
// sploh ustvariti je deterministična in javno podana, količino pa izpeljemo
// SAMO tam, kjer je aritmetika nedvoumna. Cena, marža in kosovnica se tu NE
// izračunavajo in NE shranjujejo — to ostane izključno obstoječi poti
// `/api/project-packages/[id]/bom` (enako kot pri ograjnem tekaču R488), da ta
// issue ne ustvari drugega cenovnega ali merilnega jedra.
//
// Fail-closed pravila (nobena tiha domišljija):
//   • brez projekta → paket ni ustvarljiv (paket mora viseti na projektu);
//   • brez izdelka → NE DOMIŠLJAMO ga; pisarna izbere (issue #7 ne sme
//     sprejemati cenovnih odločitev namesto nje);
//   • `unit === 'm'`   → količina = dolžina / 100 (potrebna je dolžina);
//   • `unit === 'm2'`  → količina = dolžina × višina / 10000 (potrebni sta obe);
//   • `unit === 'kos'` → iz dolžine NI kosov → zavrnjeno z razlogom;
//   • meritev je že povezana s paketom → obstoječi paket (idempotentnost:
//     ponovna potrditev/revizija NE ustvari drugega paketa).

export const HANDOFF_VERSION = 'measurement-handoff/1.0'

export type OdlokPaketa = 'USTVORI' | 'OBSTAJA' | 'ZAVRNJENO'

export interface VhodPaketa {
  projectId: string | null
  productId: string | null
  unit: string | null
  lengthCm: number | null
  heightCm: number | null
  /** že obstoječi paket, ki kaže na to meritev (idempotentnost) */
  postojeciPaketId?: string | null
}

export interface OdlokPaketaRezultat {
  odlok: OdlokPaketa
  /** razlog, ki gre VEDNO uporabniku — nikoli prazen pri ZAVRNJENO */
  razlog: string
  qty: number | null
  unit: string | null
}

function ok (v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/** Količino zaokroži na 2 decimalki (natančnost cm), brez tihega ničelnja. */
export function zaokroziKolicino (v: number): number {
  return Math.round(v * 100) / 100
}

export function odlociPaket (vhod: VhodPaketa): OdlokPaketaRezultat {
  if (vhod.postojeciPaketId) {
    return { odlok: 'OBSTAJA', razlog: 'Meritev je že povezana s paketom — novega ne ustvarjamo.', qty: null, unit: null }
  }
  if (!vhod.projectId) {
    return { odlok: 'ZAVRNJENO', razlog: 'Meritev nima projekta — paket mora viseti na projektu, zato ga ne ustvarjamo.', qty: null, unit: null }
  }
  if (!vhod.productId) {
    return {
      odlok: 'ZAVRNJENO',
      razlog: 'Za to meritev ni izbran izdelek. Paketa ne ustvarjamo brez izdelka, ker bi s tem tiho izbrali cenovni razred — izberite izdelek v pisarni.',
      qty: null, unit: null,
    }
  }
  const unit = typeof vhod.unit === 'string' ? vhod.unit : null
  if (unit === 'kos') {
    return { odlok: 'ZAVRNJENO', razlog: 'Iz mere dolžine ni mogoče nedvoumno izpeljati števila kosov — vnesite količino v pisarni.', qty: null, unit }
  }
  if (unit !== 'm' && unit !== 'm2') {
    return { odlok: 'ZAVRNJENO', razlog: `Nepoznana prodajna enota izdelka (${unit ?? '—'}) — količine ne izpeljemo.`, qty: null, unit }
  }
  if (!ok(vhod.lengthCm)) {
    return { odlok: 'ZAVRNJENO', razlog: 'Meritev nima dolžine, iz katere bi izpeljali količino paketa.', qty: null, unit }
  }
  if (unit === 'm') {
    return { odlok: 'USTVORI', razlog: `Količina iz dolžine: ${zaokroziKolicino(vhod.lengthCm / 100)} m.`, qty: zaokroziKolicino(vhod.lengthCm / 100), unit: 'm' }
  }
  if (!ok(vhod.heightCm)) {
    return {
      odlok: 'ZAVRNJENO',
      razlog: 'Paket v m2 potrebuje tudi višino — meritev je brez nje, zato površine ne računamo iz domišljene višine.',
      qty: null, unit,
    }
  }
  return { odlok: 'USTVORI', razlog: `Površina iz dolžine in višine: ${zaokroziKolicino((vhod.lengthCm * vhod.heightCm) / 10000)} m2.`, qty: zaokroziKolicino((vhod.lengthCm * vhod.heightCm) / 10000), unit: 'm2' }
}
