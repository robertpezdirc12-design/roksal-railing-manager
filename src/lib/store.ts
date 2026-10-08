'use client'

// store — prijava + trenutni zavihek (zustand, persist v localStorage)

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: string
  perms: string[]
}

interface AppState {
  token: string | null
  user: SessionUser | null
  section: string
  tab: string
  /** R458 (issue #13 §12): izbrani zagon playbooka za odpiranje z Danes → Vodeni postopek */
  playbookRunId: string | null
  /** R459 (issue #14): izbrana foto-vizualizacija za prenos v konfigurator (brez ponovnega vnosa) */
  photoVizId: string | null
  setAuth: (token: string, user: SessionUser) => void
  clearAuth: () => void
  setSection: (section: string) => void
  setTab: (tab: string) => void
  setPlaybookRunId: (runId: string | null) => void
  setPhotoVizId: (id: string | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      section: 'danes',
      tab: 'danes',
      playbookRunId: null,
      photoVizId: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
      setSection: (section) => set({ section }),
      setTab: (tab) => set({ tab }),
      setPlaybookRunId: (runId) => set({ playbookRunId: runId }),
      setPhotoVizId: (id) => set({ photoVizId: id }),
    }),
    { name: 'roksal-session' }
  )
)
