'use client'

// use-guide-speech — R490 (issue #11 §3): glasovna navodila SL/HR.
// IZKLJUČNO vgrajena govorna sinteza brskalnika (Web Speech API):
//  - brez AI-modelov, brez plačljivih storitev, brez omrežja,
//  - besedilo NE gre v nobeno zunanjo storitev (vse lokalno v napravi),
//  - če glas ali jezik ni podprt → besedilna razlaga ostane, poskus ostaja možen,
//  - navodilo se NE sme samodejno ponavljati (issue #11 §3).
//
// Podpora se RAZLIKUJE po napravi (Android/iOS/desktop) — zaznava je
// namenoma poštena: voiceAvailable pomeni »naprava navaja SL/HR glas«,
// ne pa »predvajanje bo uspelo«. Brez lažnih obljub v UI.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GuideLang } from '@/lib/smart-guide-registry'

export interface GuideSpeech {
  /** speechSynthesis obstaja v tem brskalniku */
  supported: boolean
  /** govori (predvajanje v teku) */
  speaking: boolean
  /** premor */
  paused: boolean
  /** naprava navaja glas za ta jezik (lahko je false, poskus je še vedno dovoljen) */
  voiceAvailable: (lang: GuideLang) => boolean
  /** predvajaj besedilo v izbranem jeziku (prekliče prejšnje) */
  speak: (text: string, lang: GuideLang) => void
  /** premor / nadaljevanje */
  togglePause: () => void
  /** ustavi predvajanje */
  stop: () => void
  /** utišanost (shranjena preference) */
  muted: boolean
  setMuted: (v: boolean) => void
  /** hitrost 0.5–1.5 (shranjena preference) */
  rate: number
  setRate: (v: number) => void
}

const LS_KEY = 'roksal-guide-speech'
const LANG_TAG: Record<GuideLang, string> = { sl: 'sl-SI', hr: 'hr-HR' }

export function useGuideSpeech (): GuideSpeech {
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [paused, setPaused] = useState(false)
  const [prefs, setPrefs] = useState<{ muted: boolean; rate: number }>(() => {
    if (typeof window === 'undefined') return { muted: false, rate: 1 }
    try {
      const raw = window.localStorage.getItem(LS_KEY)
      if (raw) {
        const p = JSON.parse(raw) as { muted?: boolean; rate?: number }
        return { muted: !!p.muted, rate: typeof p.rate === 'number' && p.rate >= 0.5 && p.rate <= 1.5 ? p.rate : 1 }
      }
    } catch { /* okvarjena shramba → privzeto */ }
    return { muted: false, rate: 1 }
  })
  const prefsRef = useRef(prefs)
  // ref posodobimo v efektu (ne med renderjem — pravilo react-hooks/refs)
  useEffect(() => { prefsRef.current = prefs }, [prefs])

  // persistenca nastavitev (utišanje/hitrost)
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(prefs))
    } catch { /* brez panike */ }
  }, [prefs])

  // seznam glasov se polni asinhrono (Chrome) — poslušamo voiceschanged
  useEffect(() => {
    if (!supported) return
    const read = () => setVoices(window.speechSynthesis.getVoices())
    read()
    window.speechSynthesis.addEventListener('voiceschanged', read)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', read)
  }, [supported])

  // ob odmontiranju utišaj — glas NE sme ostati brez nadzora
  useEffect(() => {
    if (!supported) return
    return () => { try { window.speechSynthesis.cancel() } catch { /* ignore */ } }
  }, [supported])

  const voiceAvailable = useCallback((lang: GuideLang): boolean => {
    if (!supported) return false
    const tag = LANG_TAG[lang]
    return voices.some((v) => v.lang?.toLowerCase().startsWith(lang === 'sl' ? 'sl' : 'hr')) ||
      voices.some((v) => v.lang?.replace('_', '-').toLowerCase() === tag.toLowerCase())
  }, [supported, voices])

  const speak = useCallback((text: string, lang: GuideLang) => {
    if (!supported || !text.trim()) return
    try {
      window.speechSynthesis.cancel() // novo predvajanje vedno prekine prejšnje
      if (prefsRef.current.muted) return // utišano = samo brez zvoka (brez avtorun-a)
      const u = new SpeechSynthesisUtterance(text)
      u.lang = LANG_TAG[lang]
      u.rate = prefsRef.current.rate
      // izbira glasu: prvi ustrezen jezik, sicer pustimo sistemu (pametna izbira naprave)
      const match = voices.find((v) => v.lang?.toLowerCase().startsWith(lang === 'sl' ? 'sl' : 'hr')) ??
        voices.find((v) => v.lang?.replace('_', '-').toLowerCase() === LANG_TAG[lang].toLowerCase())
      if (match) u.voice = match
      u.onstart = () => { setSpeaking(true); setPaused(false) }
      u.onend = () => { setSpeaking(false); setPaused(false) }
      u.onerror = () => { setSpeaking(false); setPaused(false) } // tiho: besedilo ostaja razlaga
      window.speechSynthesis.speak(u)
      setSpeaking(true) // optimistično; onerror popravi
    } catch {
      setSpeaking(false)
    }
  }, [supported, voices])

  const togglePause = useCallback(() => {
    if (!supported) return
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
        setPaused(false)
      } else if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause()
        setPaused(true)
      }
    } catch { /* nekatere naprave ne podpirajo premora — brez napake */ }
  }, [supported])

  const stop = useCallback(() => {
    if (!supported) return
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
    setSpeaking(false)
    setPaused(false)
  }, [supported])

  return {
    supported,
    speaking,
    paused,
    voiceAvailable,
    speak,
    togglePause,
    stop,
    muted: prefs.muted,
    setMuted: (v) => setPrefs((p) => ({ ...p, muted: v })),
    rate: prefs.rate,
    setRate: (v) => setPrefs((p) => ({ ...p, rate: Math.min(1.5, Math.max(0.5, v)) }))
  }
}
