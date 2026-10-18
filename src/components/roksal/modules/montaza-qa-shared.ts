// MONTAŽA QA SHARED (R549): tipi QA odgovorov in tok korektivnih ukrepov —
// en vir za kontrolo, odstopanja in primopredajo (izvlečeno bajtno-identično
// iz montaza-qa.tsx, recept R546–R548).

// ── tipi ─────────────────────────────────────────────────────────────────────

export interface QaActionRow {
  id: string; description: string; status: string; dueAt: string | null
  note: string | null; photoId: string | null; completedAt: string | null; verifiedAt: string | null
  assignee: { name: string } | null
  verifiedBy: { name: string } | null
}

export interface QaDeviationRow {
  id: string; reason: string; location: string | null; targetKey: string | null
  impactSafety: boolean; impactMaterial: boolean; impactPrice: boolean
  resolvedAt: string | null; createdAt: string; note: string | null
  checkId: string | null
  createdBy: { name: string } | null
  resolvedBy: { name: string } | null
  actions: QaActionRow[]
}

export interface QaCheckRow {
  id: string; label: string; instruction: string | null
  templateKey: string; templateVersion: number; stepId: string | null
  critical: boolean; targetKey: string | null
  status: string; note: string | null; photoId: string | null; resolutionNote: string | null
  checkedAt: string | null; checkedBy: { name: string } | null; sortOrder: number
  deviations: QaDeviationRow[]
}

export interface HandoverRow {
  id: string; workOrderId: string; version: number; status: string
  summary: string | null
  designedSnapshotId: string | null; installedSnapshotId: string | null
  diffJson: Record<string, unknown> | null; photosJson: unknown[] | null // R542: jsonb objekt/tabela
  monterConfirmedAt: string | null
  monterConfirmedBy: { name: string } | null
  customerSignedAt: string | null; customerSignedBy: string | null
  customerRemark: string | null
  createdAt: string
}

export interface QaResponse {
  data: {
    checks: QaCheckRow[]
    deviations: QaDeviationRow[]
    handover: HandoverRow | null
    povzetek: { skupaj: number; vRedu: number; napake: number; caka: number; niRelevantno: number; odstopanj: number }
  }
}

export const ACTION_FLOW = ['ODPRTO', 'V_OBRAVNAVI', 'ODRAVLJENO', 'PREVERJENO']
