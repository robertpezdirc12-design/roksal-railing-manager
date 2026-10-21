// src/lib/zai-config.ts — Preverjanje, ali je z-ai-web-dev-sdk konfiguriran.
// SDK zahteva .z-ai-config datoteko (baseUrl + apiKey) v project root, home ali /etc.
// Brez konfiguracije funkcije, ki uporabljajo VLM (AR analiza, inšpekcija) vrnejo 503.

import fs from 'fs'
import path from 'path'
import os from 'os'

export function zaiKonfiguriran (): boolean {
  const homeDir = os.homedir()
  const configPaths = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(homeDir, '.z-ai-config'),
    '/etc/.z-ai-config',
  ]
  for (const filePath of configPaths) {
    try {
      const configStr = fs.readFileSync(filePath, 'utf-8')
      const config = JSON.parse(configStr)
      if (config.baseUrl && config.apiKey) return true
    } catch {
      // datoteka ne obstaja ali je neveljavna — nadaljujemo
    }
  }
  return false
}

export const ZAI_MANJKA_SPOROCILO = 'VLM analiza ni na voljo: manjka konfiguracija z-ai (.z-ai-config). AR funkcije zahtevajo zunanji VLM servis.'
