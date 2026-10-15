// katalog-original — R527 (issue #14 §5): izrecna oznaka generičnih izdelkov.
//
// Katalog nosi DVE vrsti izdelkov:
//  - ROKSALOVI originali — SKU s predpono ROK- (ROK-OG-*, ROK-OGP-*,
//    ROK-TER-*, ROK-FAS-*, ROK-VRT-*): izdelki, za katere so bila pridobljena
//    in preverjena uradna gradiva roksal.com (barvne lestvice, produktni
//    posnetki, tehnični listi — ProductAsset, MANIFEST s SHA-256).
//  - generični demo izdelki (OGR-K-001/002, OGR-P-001/002, TER-WPC-001/002,
//    TER-ALU-001, FAS-L-001, FAS-K-002): fiksatura rekonstrukcije (seed R442)
//    BREZ preverjenih gradiv — njihov izris v fotomontaži je barvni približek
//    iz kataloške barve/RAL, nikoli originalna ROKSALOVA površina.
//
// Issue #14 §5 (poročilo docs/FOTOZAMENJAVA-POROCILO-14.md) dovoljuje DVE
// rešitvi za generične izdelke: (a) pridobitev uradnih gradiv (oskrba —
// lastnikova stran, težava #6) ALI (b) izrecna oznaka »generični izdelek,
// ni ROKSALOV original«. Ta knjižnica nosi (b); (a) jo lahko kadarkoli
// nadomesti, ko gradiva pridejo.
//
// Pravilo je DOGMA kataloga: nov ROKSALOV izdelek VEDNO dobi predpono ROK-
// (vsi doslej — od R493 naprej). Če se konvencija kdaj spremeni, se spremeni
// ta funkcija in test tests/r527.py, ki preverja, da pravilo natanko
// razvrsti vseh 9 generičnih in vseh 8 originalov fotomontažnih družin.

/** Ali je izdelek ROKSALOV original (SKU s predpono ROK-)? */
export function jeOriginalIzdelek (sku: string): boolean {
  return sku.startsWith('ROK-')
}

/** Ali je izdelek generičen demo — NI ROKSALOV original? */
export function jeGenericniIzdelek (sku: string): boolean {
  return !jeOriginalIzdelek(sku)
}

/** Izrecna oznaka za UI (issue #14 §5 — besedilo poročila, brez olepševanja). */
export const OZNAKA_GENERIKA = 'Generični izdelek, ni ROKSALOV original'
