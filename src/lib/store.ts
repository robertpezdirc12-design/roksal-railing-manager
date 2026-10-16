'use client'

// store — prijava + trenutni zavihek (zustand, persist v localStorage)
// R538: žeton seje NI VEČ persistan — localStorage je bil XSS-izluščljiv nosilec
// poverilnice. Žeton živi SAMO v pomnilniku trenutnega zavihka (Bearer rezerva
// za api-client/offline replay); dolgoročno sejo nosi httpOnly piškotek
// `roksal_session`, ki ga JavaScript ne more prebrati.

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
  /** R486 (issue #7 §3): merilni kontekst iz naloga (ZAČNI MERITEV) — monter
   *  NE izbira projekta/naloga ročno; kamera dialog ga prejme kot predpolnite. */
  measureCtx: { projectId: string; workOrderId: string; taskId?: string } | null
  /** R538: token je `string | null` — null pomeni sejo prek httpOnly piškotka
   *  (vrneči uporabnik brez Bearer žetona v pomnilniku). */
  setAuth: (token: string | null, user: SessionUser) => void
  clearAuth: () => void
  setSection: (section: string) => void
  setTab: (tab: string) => void
  setPlaybookRunId: (runId: string | null) => void
  setPhotoVizId: (id: string | null) => void
  setMeasureCtx: (ctx: { projectId: string; workOrderId: string; taskId?: string } | null) => void
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
      measureCtx: null,
      setAuth: (token, user) => set({ token, user }),
      // R486: ob odjavi počisti merilni kontekst (ne sme preživeti zamenjave uporabnika)
      clearAuth: () => set({ token: null, user: null, measureCtx: null }),
      setSection: (section) => set({ section }),
      setTab: (tab) => set({ tab }),
      setPlaybookRunId: (runId) => set({ playbookRunId: runId }),
      setPhotoVizId: (id) => set({ photoVizId: id }),
      setMeasureCtx: (ctx) => set({ measureCtx: ctx }),
    }),
    {
      name: 'roksal-session',
      // R538: v localStorage persistamo VSE RAZEN žetona (partialize) — žeton
      // ostane samo v pomnilniku zavihka; ob ponovnem obisku sejo obnovi
      // httpOnly piškotek (page.tsx boot validacija), ne localStorage.
      partialize: (state) => {
        const { token, ...brezZetona } = state
        return brezZetona
      },
      // R538: nasledstvo — stari zapisi so žeton ŠE vsebovali. Ob rehidraciji
      // ga zavrzemo, da se ne povrne v pomnilnik (naslednji set() ga s
      // partialize trajno zbriše tudi iz localStorage).
      merge: (persisted, current) => {
        const { token, ...ostalo } = (persisted ?? {}) as Partial<AppState>
        return { ...current, ...ostalo }
      },
    }
  )
)
