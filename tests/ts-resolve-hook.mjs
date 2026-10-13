// tests/ts-resolve-hook.mjs — ESM resolve hook: Bun-podobno razreševanje za node.
//
// Zakaj: testni suite-i (r465–r487) kličejo `bun -e "import … from './src/lib/x'"`
// in `bun <datoteka.ts>`. V kodi se uporablja tsconfig alias `@/…` in uvozi BREZ
// končnice. Bun oboje razreši sam; nativni node ESM ne zna in javi
// ERR_MODULE_NOT_FOUND — kar se v pasu kaže kot 7 rdečih skupin, ki nimajo
// nobene zveze z aplikacijo (na Linuxu z `bun` se ne pojaví).
//
// Hook NE posnema Bun API-jev (`Bun.*` v testjih ni — preverjeno) in ne posega
// v razreševanje npp. `next`, `react`: spremeni samo specifikatorje, ki bi
// sicer propsi. Zato je na Linuxu (kjer `bun` obstaja) izklopljen.

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// import.meta.url = <repo>/tests/<ta datotera> → `../` je koren repozitorija
const SRC = join(fileURLToPath(new URL('../', import.meta.url)), 'src')

const KONČNICE = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.json',
                  '/index.ts', '/index.tsx', '/index.mjs', '/index.js']

function obstaja (pot) {
  try { return statSync(pot).isFile() } catch { return false }
}

function izberi (base) {
  for (const k of KONČNICE) {
    const kandidat = base + k
    if (k && obstaja(kandidat)) return kandidat
  }
  return null
}

export async function resolve (specifier, context, nextResolve) {
  // 1) tsconfig alias `@/…` → <repo>/src/…
  if (specifier.startsWith('@/')) {
    const hits = izberi(join(SRC, specifier.slice(2)))
    if (hits) return { url: pathToFileURL(hits).href, shortCircuit: true }
  }
  // 2) relativni/uvozi brez končnice (Bun jih dopolní sam; `node -e` ima kot
  //    starša mapo cwd-ja, zato je parentURL lahko manjkajoč)
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file://')) {
    try {
      return await nextResolve(specifier, context)
    } catch (err) {
      const starš = context?.parentURL
        ? dirname(fileURLToPath(context.parentURL))
        : process.cwd()
      const base = specifier.startsWith('file://')
        ? fileURLToPath(specifier)
        : join(starš, specifier)
      const hits = izberi(base)
      if (hits) return { url: pathToFileURL(hits).href, shortCircuit: true }
      throw err
    }
  }
  return nextResolve(specifier, context)
}

export async function load (url, context, nextLoad) {
  return nextLoad(url, context)
}
