// tests/ts-resolve-register.mjs — vklopi ts-resolve-hook za `node --import`.
// Uporablja ga tests/toolshim.sh, kadar JS-zagonilec NI bun (Windows ali Linux
// brez Buna). `--import` je dovoljena vrednost v NODE_OPTIONS, hook pa je aktiven
// samo za ESM razreševanje; CJS (`require`) in npm/next ostanenja nespremenjena.
import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
