// codes — R439: varna generacija zaporednih kod (popavek hrošča iz issue #6 testov).
//
// Nekoč: koda = `${prefix}${leto}-${count + 1}` — count pade OB BRISANJU zapisov
// (arhiviranje, testi, GDPR izbris) → nova koda trči z obstoječo → unique
// constraint P2002 → HTTP 500 pri ustvarjanju naloga/projekta/proizvodnje.
//
// Zdaj: naslednja številka glede na DEJANSKO zasedene kode v tekočem letu —
// začnimo pri existing.length + 1 in preskočimo že zasedene (odpor tudi na vrzeli).

/** Naslednja prosta koda <prefix><leto>-<NNN> iz seznama obstoječih kod. */
export function nextCodeFromList (existing: string[], prefix: string): string {
  const year = new Date().getFullYear()
  const full = `${prefix}${year}-`
  const used = new Set(existing.filter((c) => c.startsWith(full)))
  let next = used.size + 1
  while (used.has(`${full}${String(next).padStart(3, '0')}`)) next++
  return `${full}${String(next).padStart(3, '0')}`
}
