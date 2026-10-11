// permissions-core — REKONSTRUKCIJA R431 (vir: R240/R425–R426 blueprint)
// EN VIR resnice o dovoljenih. Čist client-safe lib — NIČ strežniških uvozov.
// Katalog: 39 pravic (R425: 35 → 38 z payments.read/manage, audit.read;
// R481: 39 z integrations.manage — samo ADMIN/VODJA, vzorec portal.manage)

export const PERMISSIONS = [
  // projekti
  'projects.read', 'projects.write', 'projects.command',
  // stranke
  'customers.read', 'customers.write',
  // ponudbe
  'quotes.read', 'quotes.create', 'quotes.approve',
  // posel
  'deal.lock',
  // računi
  'invoices.read', 'invoices.issue',
  // plačila (R425: ločena od računov)
  'payments.read', 'payments.manage',
  // nalogi
  'nalog.read', 'nalog.write', 'nalog.transition',
  // meritve
  'measurements.read', 'measurements.write',
  // zaloga
  'inventory.read', 'inventory.write',
  // cene & nabava
  'price.override', 'procurement.receive',
  // katalog
  'catalog.read', 'catalog.write',
  // CRM
  'crm.read', 'crm.write',
  // proizvodnja
  'production.read', 'production.manage',
  // dokumenti
  'documents.read', 'documents.generate',
  // uporabniki
  'users.read', 'users.write',
  // revizija (R425: audit.read razcepljena iz administracije)
  'audit.read',
  // portal, varnost, galerija, oprema
  'portal.manage', 'security.read', 'gallery.read', 'equipment.read',
  // integracije (R481: webhook naročnine/dostave — issue #9 §9)
  'integrations.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]
export type Role = 'ADMIN' | 'VODJA' | 'MONTER' | 'SKLADISCE' | 'PROIZVODNJA'

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  VODJA: 'Vodja',
  MONTER: 'Monter',
  SKLADISCE: 'Skladišče',
  PROIZVODNJA: 'Proizvodnja',
}

const ALL = [...PERMISSIONS] as Permission[]

// Števila po blueprintu: MONTER 15, SKLADISCE 9, PROIZVODNJA TOČNO 10 (R425)
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ALL,
  VODJA: ALL.filter((p) => p !== 'security.read'),
  MONTER: [
    'projects.read', 'projects.write',
    'customers.read',
    'quotes.read',
    'nalog.read', 'nalog.write', 'nalog.transition',
    'measurements.read', 'measurements.write',
    'inventory.read', 'catalog.read', 'crm.read',
    'documents.read', 'gallery.read', 'equipment.read',
  ],
  SKLADISCE: [
    'projects.read', 'customers.read',
    'inventory.read', 'inventory.write',
    'procurement.receive',
    'catalog.read', 'catalog.write',
    'documents.read', 'audit.read',
  ],
  PROIZVODNJA: [ // TOČNO 10 (R425 §19)
    'projects.read',
    'nalog.read', 'nalog.write',
    'inventory.read', 'catalog.read',
    'production.read', 'production.manage',
    'documents.read', 'measurements.read', 'equipment.read',
  ],
}

// R428: kontekstni bralni obseg — SAMO za audit.read (sistemski dnevnik)
export const READS_ALL_PROJECTS: Role[] = ['ADMIN', 'VODJA', 'SKLADISCE', 'PROIZVODNJA']

export function permissionsForRole (role: string): Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? []
}

export function hasPerm (perms: string[] | undefined, perm: Permission): boolean {
  // fail-closed: brez seznama pravic → BREZ dostopa
  return !!perms && perms.includes(perm)
}
