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
  setAuth: (token: string, user: SessionUser) => void
  clearAuth: () => void
  setSection: (section: string) => void
  setTab: (tab: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      section: 'danes',
      tab: 'danes',
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
      setSection: (section) => set({ section }),
      setTab: (tab) => set({ tab }),
    }),
    { name: 'roksal-session' }
  )
)
