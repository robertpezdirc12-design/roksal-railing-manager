// seed-r449.cjs — R449 (issue #8): verzioniranje kataloga in inženirskih pravil.
// Dopolnilni DEMO podatki v obstoječo bazo (idempotentno — po vzoru seed-r447.cjs):
// če verzije še ne obstajajo, ustvari par zgodovinskih verzij na obstoječih
// profilih/pravilih (demo sled kdo/kdaj/staro→novo). Ne briše ničesar.
// Uporaba: node prisma/seed-r449.cjs
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

async function main () {
  // ── verzije profilov kataloga (CatalogVersion) ─────────────────────────────
  const cvCount = await db.catalogVersion.count()
  if (cvCount > 0) {
    console.log(`[seed-r449] CatalogVersion že obstaja (${cvCount}) — preskočeno`)
  } else {
    const vodja = await db.user.findFirst({ where: { role: 'VODJA' }, select: { id: true, name: true } })
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, name: true } })
    const aluL80 = await db.profile.findUnique({ where: { sku: 'ALU-L-80' } })
    const inoxBal = await db.profile.findUnique({ where: { sku: 'INOX-BAL-10' } })

    if (aluL80) {
      // demo zgodovina: cena 82 → 89 (sedanja vrednost ostane nespremenjena)
      await db.catalogVersion.create({
        data: {
          profileId: aluL80.id,
          userId: vodja?.id ?? admin?.id ?? null,
          data: JSON.stringify({
            before: { pricePerM: 82 },
            after: { pricePerM: aluL80.pricePerM },
            profile: {
              sku: aluL80.sku, name: aluL80.name, material: aluL80.material, type: aluL80.type,
              pricePerM: aluL80.pricePerM, description: aluL80.description, active: aluL80.active,
            },
          }),
          note: 'Demo: sezonski popravek cene (82 → 89 €/m)',
        },
      })
      console.log(`[seed-r449] CatalogVersion za ${aluL80.sku} (popravek cene)`)
    }
    if (inoxBal) {
      await db.catalogVersion.create({
        data: {
          profileId: inoxBal.id,
          userId: admin?.id ?? null,
          data: JSON.stringify({
            before: { description: 'Inox balustrada, steklo 8 mm' },
            after: { description: inoxBal.description ?? '' },
            profile: {
              sku: inoxBal.sku, name: inoxBal.name, material: inoxBal.material, type: inoxBal.type,
              pricePerM: inoxBal.pricePerM, description: inoxBal.description, active: inoxBal.active,
            },
          }),
          note: 'Demo: dopolnitev tehničnega opisa (steklo 8 → 10 mm)',
        },
      })
      console.log(`[seed-r449] CatalogVersion za ${inoxBal.sku} (opis)`)
    }
  }

  // ── zgodovina vrednosti pravil (RuleVersion) ────────────────────────────────
  const rvCount = await db.ruleVersion.count()
  if (rvCount > 0) {
    console.log(`[seed-r449] RuleVersion že obstaja (${rvCount}) — preskočeno`)
  } else {
    const proizvodnja = await db.user.findFirst({ where: { role: 'PROIZVODNJA' }, select: { id: true, name: true } })
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, name: true } })

    const snapshots = [
      { key: 'max_razdalja_stebrov', old: { value: 130 }, note: 'Demo: povečanje varnostnega standarda (130 → 120 cm)' },
      { key: 'visina_ograje_min', old: { value: 100 }, note: 'Demo: uskladitev z Uredbo (100 → 90 cm)' },
    ]
    for (const s of snapshots) {
      const rule = await db.engineeringRule.findUnique({ where: { key: s.key } })
      if (!rule) continue
      await db.ruleVersion.create({
        data: {
          ruleId: rule.id,
          userId: proizvodnja?.id ?? admin?.id ?? null,
          oldValue: JSON.stringify({ key: rule.key, label: rule.label, value: s.old.value, unit: rule.unit, note: rule.note, active: rule.active }),
          newValue: JSON.stringify({ key: rule.key, label: rule.label, value: rule.value, unit: rule.unit, note: rule.note, active: rule.active }),
          note: s.note,
        },
      })
      console.log(`[seed-r449] RuleVersion za ${rule.key} (${s.old.value} → ${rule.value})`)
    }
  }
  console.log('[seed-r449] konec')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
