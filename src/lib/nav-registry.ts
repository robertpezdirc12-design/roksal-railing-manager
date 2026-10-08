// nav-registry — REKONSTRUKCIJA R431 → IA R448 (issue #7 §11, ciljna struktura)
// EN VIR navigacije. Čist client-safe lib — NIČ strežniških uvozov.
// IA (R448 §11): DANES | PRODAJA | PROJEKTI | OPERATIVA | SKLADIŠČE | KATALOG |
// FINANCE | SERVIS | POROČILA | VARNOST | PROFIL — 28 zavihkov v 11 sekcijah.
// Zavihki (id + gate) so NEspremenjeni — spreminja se samo razvrstitev.

import type { Permission } from './permissions-core'

export type SectionId =
  | 'danes' | 'prodaja' | 'projekti' | 'operativa' | 'skladisce' | 'katalog'
  | 'finance' | 'servis' | 'porocila' | 'varnost' | 'profil'

export interface TabDef {
  id: string
  label: string
  gate: Permission | null // null = vedno vidno (profil)
  desc: string
}

export interface SectionDef {
  id: SectionId
  label: string
  tabs: TabDef[]
}

// 28 zavihkov v 11 sekcijah — ciljna poslovna IA (R448, issue #7 §11)
export const SECTIONS: SectionDef[] = [
  {
    id: 'danes',
    label: 'Danes',
    tabs: [
      { id: 'danes', label: 'Danes', gate: 'nalog.read', desc: 'Operativni vhod — terenski tok dneva' },
      // R458 (issue #13): VODENI POSTOPEK — deterministični playbooki vodijo
      // monterja skozi celoten postopek (SCRIPT → GUIDE → CAPTURE → VALIDATE →
      // CONFIRM → HANDOFF) brez runtime AI.
      { id: 'playbook', label: 'Vodeni postopek', gate: 'nalog.read', desc: 'Playbook vodena izvedba na terenu (R458)' },
    ],
  },
  {
    id: 'prodaja',
    label: 'Prodaja',
    tabs: [
      { id: 'crm', label: 'CRM', gate: 'crm.read', desc: 'Vodi in priložnosti' },
      { id: 'stranke', label: 'Stranke', gate: 'customers.read', desc: 'Seznam strank in kontakti' },
      { id: 'ponudbe', label: 'Ponudbe', gate: 'quotes.read', desc: 'Ponudbe s pozicijami in podpisi' },
      { id: 'postsig', label: 'PostSig', gate: 'deal.lock', desc: 'Zaklepanje posla po podpisu' },
    ],
  },
  {
    id: 'projekti',
    label: 'Projekti',
    tabs: [
      { id: 'projekti', label: 'Projekti', gate: 'projects.read', desc: 'Vsi projekti z statusi' },
      { id: 'meritve', label: 'Meritve', gate: 'measurements.read', desc: 'Merjenje ograj po terenu' },
      // R460 (issue #15): OGRADNJA — specializirana ograjna izmera z voženim
      // tekačem (ZAČETEK → STEBER → SEGMENT → KONEC), terenom, produktnim
      // razporedom stebrov in VERIFIED preveritvami (zunanji merilnik).
      { id: 'ogradnja', label: 'Ogradnja', gate: 'measurements.read', desc: 'Vodena ograjna izmera — tekač (R460)' },
      // R461 (issue #16): ZAJEM — reality capture QA (pokritost, drift,
      // referenčna mreža, vodena ruta) nad tekačem; zaključek → AS-MEASURED.
      { id: 'zajem', label: 'Zajem', gate: 'measurements.read', desc: 'Reality capture QA — pokritost/drift/reference (R461)' },
      { id: 'foto', label: 'Foto', gate: 'measurements.write', desc: 'Foto zajem na terenu' },
      { id: 'nagib', label: 'Nagib', gate: 'projects.read', desc: 'Kalkulator nagibov stopnišč' },
      // R447 (issue #7 §5): KONFIGURATOR — nadomešča stari Kalkulator (hardcoded
      // poslovne cene — kršitev §15). Tok: produkt → izmera → izračun → paket/BOM/ponudba.
      { id: 'konfigurator', label: 'Konfigurator', gate: 'quotes.create', desc: 'Konfigurator produktov po družinah (R447)' },
      { id: 'viz', label: 'Vizualizacija', gate: 'projects.read', desc: '3D vizualizacije ograj' },
      // R459 (issue #14): FOTO VIZUALIZACIJA — fotorealistična menjava ograje na
      // originalni fotografiji (PREJ/POTEM, variante A/B/C, izvoz/PDF).
      { id: 'foto-replace', label: 'Foto vizualizacija', gate: 'projects.read', desc: 'Realistic photo replacement (R459)' },
      // R461 (issue #16): DIGITALNI DVOJČEK — AS-MEASURED → AS-DESIGNED →
      // AS-PRODUCED → AS-INSTALLED, geometrijski diff + cross-check virov.
      { id: 'dvojcek', label: 'Digitalni dvojček', gate: 'projects.read', desc: 'Digitalni dvojček projekta — AS-BUILT (R461)' },
      { id: 'ar', label: 'AR', gate: 'projects.read', desc: 'Dopolnjena resničnost na terenu' },
      { id: 'signatura', label: 'Signatura', gate: 'quotes.create', desc: 'Zajem podpisa stranke' },
      { id: 'dokumenti', label: 'Dokumenti', gate: 'documents.read', desc: 'Arhiv dokumentov' },
      { id: 'pdf', label: 'PDF', gate: 'documents.generate', desc: 'Izvoz dokumentov v PDF' },
    ],
  },
  {
    id: 'operativa',
    label: 'Operativa',
    tabs: [
      { id: 'nalogi', label: 'Nalogi', gate: 'nalog.read', desc: 'Delovni nalogi — osrednji center' },
      { id: 'teren', label: 'Teren', gate: 'projects.write', desc: 'Terenski pregled projektov' },
      // R445 (issue #7 §9): DOSTAVE — dostave, vozila, ekipe/podizvajalci.
      { id: 'dostave', label: 'Dostave', gate: 'projects.read', desc: 'Dostave, vozila, ekipe (R445)' },
      { id: 'logistika', label: 'Plan', gate: 'production.manage', desc: 'Razpored in termini (montaže)' },
      { id: 'proizvodnja', label: 'Proizvodnja', gate: 'production.read', desc: 'Proizvodni nalogi' },
      { id: 'galerija', label: 'Galerija', gate: 'gallery.read', desc: 'Galerija zaključenih del' },
      { id: 'orodjarina', label: 'Orodjarina', gate: 'equipment.read', desc: 'Merilna orodjarina' },
    ],
  },
  {
    id: 'skladisce',
    label: 'Skladišče',
    tabs: [
      { id: 'zaloga', label: 'Zaloga', gate: 'inventory.read', desc: 'Pregled/gibanja/picking + dobavitelji' },
      { id: 'material-v5', label: 'Kosovnice', gate: 'inventory.read', desc: 'BOM kosovnice z eksplicitnimi ID (R442)' },
      // R452 (issue #7 §16 P3): AVTOMATSKI PREDLOG MATERIALA — povpraševanje
      // odprtih kosovnic − razpoložljiva zaloga + dopolnitev nizke zaloge.
      { id: 'predlogi', label: 'Predlogi naročila', gate: 'inventory.read', desc: 'Avtomatski predlog materiala iz povpraševanja' },
    ],
  },
  {
    id: 'katalog',
    label: 'Katalog',
    tabs: [
      // Izdelki | Ceniki sta zavihka znotraj modula; družine (terase, ograje,
      // fasade, pregrade, napušči, komponente) so hitri filter na Izdelkih.
      { id: 'katalog', label: 'Katalog', gate: 'catalog.read', desc: 'Izdelki po družinah in ceniki' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    tabs: [
      // Računi + plačila + terjatve so zavihki znotraj modula racuni.
      { id: 'racuni', label: 'Računi', gate: 'invoices.read', desc: 'Računi, plačila in terjatve (R425)' },
    ],
  },
  {
    id: 'servis',
    label: 'Servis',
    tabs: [
      // Garancije | Reklamacije | Servis so zavihki znotraj modula (R446).
      // Monter vidi SAMO zavihek Servis (svoji primeri) — modul sama skrije ostala zavihka.
      { id: 'servis', label: 'Servis', gate: 'projects.read', desc: 'Garancije, reklamacije, servis (R446)' },
    ],
  },
  {
    id: 'porocila',
    label: 'Poročila',
    tabs: [
      { id: 'dashboard', label: 'Preglednica', gate: 'projects.read', desc: 'KPI in stanje portfelja (kokpit)' },
      // R451 (issue #7 §16 P3): NAPREDNA POROČILA — trendi po mesecih za 4 tipe
      // (prodaja/servis/zaloga/projekti); sklopi fail-closed po pravicah uporabnika.
      { id: 'reports', label: 'Napredna poročila', gate: 'projects.read', desc: 'Trendi in analitika po mesecih' },
    ],
  },
  {
    id: 'varnost',
    label: 'Varnost',
    tabs: [
      { id: 'varnost', label: 'Revizija', gate: 'audit.read', desc: 'Revizijski dnevnik (R428)' },
      { id: 'vodja-ekipa', label: 'Uporabniki in vloge', gate: 'users.read', desc: 'Uporabniki in vloge' },
    ],
  },
  {
    id: 'profil',
    label: 'Profil',
    tabs: [
      { id: 'profil', label: 'Profil', gate: null, desc: 'Moj profil, tema, odjava' },
    ],
  },
]

export const ALL_TABS: TabDef[] = SECTIONS.flatMap((s) => s.tabs)

export function tabById (id: string): TabDef | undefined {
  return ALL_TABS.find((t) => t.id === id)
}

export function sectionForTab (id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.tabs.some((t) => t.id === id))
}

// fail-closed (R426): neznani zavihek → ni dostopa
export function tabVisible (perms: string[] | undefined, tab: TabDef): boolean {
  if (tab.gate === null) return true
  return !!perms && perms.includes(tab.gate)
}
