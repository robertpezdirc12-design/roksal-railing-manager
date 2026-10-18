'use client'

// VODENI POSTOPEK — R458 (GitLab issue #13: SCRIPT-FIRST FIELD WORKFLOW).
// Monterjeva glavna izkušnja (§12): MOJ DAN → izberi nalog → NADALJUJ →
// sistem vodi skozi korake. En zaslon = en glavni cilj (§3): velika primarna
// akcija, malo sekundarnih, vedno viden napredek KORAK X/N.
// BREZ runtime AI — naslednji korak izračuna deterministični engine (§2).
//
// R549: ta datoteka je VSTOPNA (izbira pogleda: domov / runner / admin).
// Gradniki živijo v poddatotekah: shared (tipi/konstante/naprava), home
// (izbira naloga + zagoni), run (runner), korak (trenutni korak + glava),
// admin (upravljanje definicij) — bajtno-identični premiki, brez spremembe
// obnašanja (recept R546–R548).

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { PlaybookHome } from './playbook-home'
import { RunView } from './playbook-run'
import { AdminDefs } from './playbook-admin'

// ═══ GLAVNI MODUL ═════════════════════════════════════════════════════════

export default function PlaybookModule () {
  const user = useAppStore((s) => s.user)
  const playbookRunId = useAppStore((s) => s.playbookRunId)
  const setPlaybookRunId = useAppStore((s) => s.setPlaybookRunId)
  const [aktivniRun, setAktivniRun] = useState<string | null>(playbookRunId)
  // ob preklopu iz Danes → Vodeni postopek: uskladi brez efekta
  // (uradni vzorec »adjust state during render« — react.dev)
  const [videnRunId, setVidenRunId] = useState<string | null>(playbookRunId)
  if (videnRunId !== playbookRunId) {
    setVidenRunId(playbookRunId)
    if (playbookRunId) setAktivniRun(playbookRunId)
  }

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'VODJA'
  const [adminView, setAdminView] = useState(false)

  if (aktivniRun) {
    return (
      <RunView
        runId={aktivniRun}
        onNazaj={() => { setAktivniRun(null); setPlaybookRunId(null) }}
      />
    )
  }

  if (adminView && isAdmin) {
    return <AdminDefs onNazaj={() => setAdminView(false)} />
  }

  return (
    <PlaybookHome
      onOdpriRun={(id) => setAktivniRun(id)}
      onAdmin={() => setAdminView(true)}
      isAdmin={isAdmin}
    />
  )
}
