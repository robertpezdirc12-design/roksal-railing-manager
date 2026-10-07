// nav-registry — REKONSTRUKCIJA R431 (vir: R426 + R429 IA register)
// EN VIR navigacije. Čist client-safe lib — NIČ strežniških uvozov.
// IA (R429): DANES | PROJEKTI | ZAJEM | PISARNA | PROFIL — izčrpna preslikava vseh zavihkov.

import type { Permission } from './permissions-core'

export type SectionId = 'danes' | 'projekti' | 'zajem' | 'pisarna' | 'profil'

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

// MAIN (8) + MORE → 29 zavihkov v 5 sekcijah (R429: 27 → rekonstrukcija doda stranke/racuni kot prvorazredna)
export const SECTIONS: SectionDef[] = [
  {
    id: 'danes',
    label: 'Danes',
    tabs: [
      { id: 'danes', label: 'Danes', gate: 'nalog.read', desc: 'Operativni vhod — terenski tok dneva' },
    ],
  },
  {
    id: 'projekti',
    label: 'Projekti',
    tabs: [
      { id: 'dashboard', label: 'Preglednica', gate: 'projects.read', desc: 'KPI in stanje portfelja' },
      { id: 'projekti', label: 'Projekti', gate: 'projects.read', desc: 'Vsi projekti z statusi' },
      { id: 'stranke', label: 'Stranke', gate: 'customers.read', desc: 'Seznam strank in kontakti' },
      { id: 'ponudbe', label: 'Ponudbe', gate: 'quotes.read', desc: 'Ponudbe s pozicijami in podpisi' },
      { id: 'racuni', label: 'Računi', gate: 'invoices.read', desc: 'Računi in plačila (R425 ločitev)' },
      { id: 'nalogi', label: 'Nalogi', gate: 'nalog.read', desc: 'Delovni nalogi — osrednji center' },
      { id: 'teren', label: 'Teren', gate: 'projects.write', desc: 'Terenski pregled projektov' },
    ],
  },
  {
    id: 'zajem',
    label: 'Zajem',
    tabs: [
      { id: 'meritve', label: 'Meritve', gate: 'measurements.read', desc: 'Merjenje ograj po terenu' },
      { id: 'foto', label: 'Foto', gate: 'measurements.write', desc: 'Foto zajem na terenu' },
      { id: 'nagib', label: 'Nagib', gate: 'projects.read', desc: 'Kalkulator nagibov stopnišč' },
      { id: 'kalkulator', label: 'Kalkulator', gate: 'quotes.create', desc: 'Komercialni kalkulator ponudbe' },
      { id: 'signatura', label: 'Signatura', gate: 'quotes.create', desc: 'Zajem podpisa stranke' },
      { id: 'material-v5', label: 'Kosovnice', gate: 'inventory.read', desc: 'BOM kosovnice z eksplicitnimi ID (R442)' },
      { id: 'orodjarina', label: 'Orodjarina', gate: 'equipment.read', desc: 'Merilna orodjarina' },
      { id: 'viz', label: 'Vizualizacija', gate: 'projects.read', desc: '3D vizualizacije ograj' },
      { id: 'ar', label: 'AR', gate: 'projects.read', desc: 'Dopolnjena resničnost na terenu' },
    ],
  },
  {
    id: 'pisarna',
    label: 'Pisarna',
    tabs: [
      { id: 'crm', label: 'CRM', gate: 'crm.read', desc: 'Vodi in priložnosti' },
      { id: 'dokumenti', label: 'Dokumenti', gate: 'documents.read', desc: 'Arhiv dokumentov' },
      { id: 'zaloga', label: 'Zaloga', gate: 'inventory.read', desc: 'Stanje zaloge in losi' },
      { id: 'katalog', label: 'Katalog', gate: 'catalog.read', desc: 'Profili in izdelki' },
      { id: 'logistika', label: 'Logistika', gate: 'production.manage', desc: 'Razpored in termini' },
      { id: 'proizvodnja', label: 'Proizvodnja', gate: 'production.read', desc: 'Proizvodni nalogi' },
      { id: 'galerija', label: 'Galerija', gate: 'gallery.read', desc: 'Galerija zaključenih del' },
      { id: 'varnost', label: 'Varnost', gate: 'audit.read', desc: 'Revizijski dnevnik (R428)' },
      { id: 'vodja-ekipa', label: 'Vodja / ekipa', gate: 'users.read', desc: 'Uporabniki in vloge' },
      { id: 'pdf', label: 'PDF', gate: 'documents.generate', desc: 'Izvoz dokumentov v PDF' },
      { id: 'postsig', label: 'PostSig', gate: 'deal.lock', desc: 'Zaklepanje posla po podpisu' },
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
