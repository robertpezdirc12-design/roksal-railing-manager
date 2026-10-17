// json — R542: drobni pomožniki za Prisma Json polja (TEXT → JSONB pretvorba).
// Po pretvorbi odjemalec vrača razčlenjeno JsonValue (ne niza več) — ti
// pomožniki pokrivajo dve pogosti obliki: varen dostop do objekta in
// poštena primerjava objektov po vsebini (jsonb normalizira vrstni red
// ključev, zato primerjava nizov ni zanesljiva).

/** Varno spravi JsonValue v objekt: objekt → objekt, vse ostalo
 *  (null/niz/število/tabela/boolean) → null. Nadomesti obrambne
 *  JSON.parse v try/catch, ki so po pretvorbi odveč. */
export function asJsonObject (v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null
}

/** Kanonična (globinsko urejena) serializacija — enaka vsebina v drugačnem
 *  vrstnem redu ključev da enak niz. Za primerjave »se je objekt spremenil?«
 *  (npr. idempotenca, detekcija spremembe params). */
export function canonicalJson (v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  return `{${Object.keys(v as Record<string, unknown>).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

/** R542: kot asJsonObject, a sprejme tudi NIZ (JSON.stringify oblika).
 *  Utemeljitev ostanka JSON.parse: pomožnike družine tech/renderParams
 *  (photo-replace-core, fence-run-engine, viz-core) kličejo testni mostiči
 *  (r480/r517/r518 … pošiljajo JSON nize) in ops skripte ZRAV z jsonb
 *  objekti — oba vhoda morata delovati. */
export function asJsonObjectLoose (v: unknown): Record<string, unknown> | null {
  if (typeof v === 'string') {
    try { return asJsonObject(JSON.parse(v)) } catch { return null }
  }
  return asJsonObject(v)
}

/** R542: normalizacija tech JSON izdela — smeti (niz, ki ni objekt, tabela,
 *  null) → {} (družina tech helperjev vrača privzete vrednosti, ne null). */
export function techObject (v: unknown): Record<string, unknown> {
  return asJsonObjectLoose(v) ?? {}
}
