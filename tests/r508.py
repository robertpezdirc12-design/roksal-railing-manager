#!/usr/bin/env python3
"""tests/r508.py — R508 (issue #7 — MONTER CAMERA-FIRST): ZMOŽLJIVOSTI KAMERE,
OSNUTEK PO SEJI in STATUS SHRANJEVANJA korak-na-korak.

Kaj ta suite ščiti (tri resnični napake, ne dekoracija):
  A) camera-capabilities (DOM-free, bun): TRI stanja PODPRTO / NI_PODPRE /
     NI_DOKAZA. Brskalnik, ki `getCapabilities()` nima (ali mu API manjka),
     NE SME biti prikazan kot »brez bliskavice« — monter bi nehal zajemati.
     Enako obratno: gumb se NE SME pokazati, če naprava zmožnosti ni potrdila.
  B) nastaviTorch: `VKLOPLJEN/IZKLOPLJEN` SAMO, če ga `getContext()` potrdi;
     sicer `SPREJETO_BREZ_POTRDITVE` (issue #7 §7: brez lažnih stanj).
     NI_PODPRE ne sme nikoli poklicati `applyConstraints`.
  C) prestejVideoVhode: v nezavarjenem kontekstu `null` (= NI_DOKAZA), vhodi
     brez `deviceId` se NE štejejo.
  D) measure-draft SEJE (IndexedDB mock): začetek druge meritve (drug
     projekt/nalog) NE SME tiho prepisati prve — obe seji ostaneta.
     `loadDraft` brez ključa = najnovejša; z `ključem` = točna seja.
     `clearDraft(uid, key)` pobriše SAMO to sejo; `clearDraft(uid)` vse.
     `MAX_SEJE` meja VRNE izpadle ključe (UI jih pove, ne tiho izbriše).
     LEGACY R486 zapis (razprostrt) je še vedno BRAN — posodobitev ne sme
     pobrisati monterjevega osnutka na že nameščenih telefonih.
     Prevelik osnutek → napaka, ostale seje nedotaknjene.
     Vezava na userId (IDOR): drug uporabnik tujih sej NE vidi.
  E) stanjeShranjevanja (offline.ts, čista funkcija): prioriteta NESKLADJE >
     NAPAKA > ČAKA > SINHRONIZIRANO > SHRANJENO_V_TELEFONU; nobeno stanje
     ne sme trditi »sinhronizirano«, ko kaj čaka ali manjka.
  F) žičenje v UI (source grep): meritve-kamera uporablja zmogljivosti,
     bliskavico/preklop, statusno vrstico in KLJUČNO (ne vseslovanski)
     brisanje osnutka.

Suite NE potrebuje strežnika in NE piše v bazo (issue #7: brez novega
merilnega ali cenovnega jedra, brez novih odvisnosti, brez AI).
"""
import json, os, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS, FAIL = 0, 0

def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')
def chk (cond, msg): ok(msg) if cond else bad(msg)

def bun_js (script):
    """bun → node nadomestek (tests/toolshim.sh); TS uvozi prek ts-resolve hooka."""
    env = {**os.environ}
    env.setdefault('NODE_OPTIONS', '--import ./tests/ts-resolve-register.mjs')
    r = subprocess.run(['bun', '-e', script], capture_output=True, text=True, cwd=REPO, env=env)
    out = (r.stdout or '').strip().splitlines()
    for line in reversed(out):
        if line.startswith('{'):
            try: return json.loads(line)
            except Exception: break
    return {'_err': (r.stderr or r.stdout or '')[:900]}

# minimalen IndexedDB mock — samo vmesnik, ki ga measure-draft uporablja
IDB_MOCK = r'''
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
class Req { constructor () { this.result = undefined; this.onsuccess = null; this.onerror = null; this.onupgradeneeded = null } }
const storeMaps = {}
const mkStore = (n) => { const m = storeMaps[n]; return {
  get: (k) => { const r = new Req(); r.result = m.get(k); queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
  getAll: () => { const r = new Req(); r.result = [...m.values()]; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
  put: (v) => { const r = new Req(); m.set(v.userId, v); r.result = v; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
  delete: (k) => { const r = new Req(); m.delete(k); queueMicrotask(() => r.onsuccess && r.onsuccess()); return r },
} }
const db = {
  objectStoreNames: { contains: (n) => n in storeMaps },
  createObjectStore: (n) => { storeMaps[n] = new Map(); return mkStore(n) },
  transaction: (n) => { const s = mkStore(n); return { objectStore: () => s } },
  close: () => {},
}
globalThis.indexedDB = { open: () => { const r = new Req(); r.result = db
  queueMicrotask(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess() })
  return r } }
'''

print('════ R508 — zmožnosti kamere + osnutek po seji + status shranjevanja (issue #7) ════')

# ═══ A) zmogljivosti: tri stanja, ne binarna domneva ════════════════════════
print('── A) camera-capabilities: PODPRTO / NI_PODPRE / NI_DOKAZA')
A = bun_js(r'''
const { zmogljivostiKamere, napisZmogljivosti, naslednjaSmer, napisSmeri } = await import('./src/lib/camera-capabilities')
const tr = (cap) => ({ getCapabilities: () => cap })
const z1 = zmogljivostiKamere(tr({ torch: true }), 2)
const z2 = zmogljivostiKamere(tr({}), 2)
const z3 = zmogljivostiKamere({}, 2)                       // brez getCapabilities API-ja
const z4 = zmogljivostiKamere(tr({ torch: ['off', 'on'] }), 1)  // seznamna oblika
const z5 = zmogljivostiKamere(tr({ torch: true }), null)       // nezavarjen kontekst
const z6 = zmogljivostiKamere(null, null)                       // kamera ni uspela
console.log(JSON.stringify({
  z1, z2, z3, z4, z5, z6,
  napisPodprto: napisZmogljivosti(z1),
  napisDokaz: napisZmogljivosti(z3),
  smer: [naslednjaSmer('environment'), naslednjaSmer('user'), napisSmeri('user')],
  throws: zmogljivostiKamere({ getCapabilities: () => { throw new Error('x') } }, 2).torch,
}))
''')
if '_err' in A:
    bad(f'bun A: {A["_err"]}')
else:
    chk(A['z1']['torch'] == 'PODPRTO' and A['z1']['preklop'] == 'PODPRTO', 'potrjena bliskavica + 2 kameri → PODPRTO')
    chk(A['z2']['torch'] == 'NI_PODPRE', 'getCapabilities brez torch → NI_PODPRE (gumb se NE prikaže)')
    chk(A['z3']['torch'] == 'NI_DOKAZA', 'brez API-ja → NI_DOKAZA, ne »ni podprto«')
    chk(A['z4']['torch'] == 'PODPRTO' and A['z4']['preklop'] == 'NI_PODPRE', 'seznamna oblika torch šteje; 1 kamera → preklop NI_PODPRE')
    chk(A['z5']['preklop'] == 'NI_DOKAZA' and A['z5']['razlogPreklopa'] == 'nezavarjen-kontekst', 'nezavarjen kontekst → razlog nezavarjen-kontekst')
    chk(A['z6']['torch'] == 'NI_DOKAZA' and A['z6']['preklop'] == 'NI_DOKAZA', 'kamera ni dosegljiva → nič ne trdimo')
    chk(A['throws'] == 'NI_DOKAZA', 'getCapabilities, ki vrže izjemo → NI_DOKAZA in ne padec')
    chk('bliskavica' in A['napisPodprto'] and 'ni potrjena' in A['napisDokaz'], 'napis zmore PODPORNO in nepotrjeno obliko')
    chk(A['smer'] == ['user', 'environment', 'sprednja kamera'], 'preklop smeri je determinističen')

# ═══ B) torch ukaz: dokaz proti »sprejeto brez potrditve« ═══════════════════
print('── B) nastaviTorch: stanje samo z dokazom naprave')
B = bun_js(r'''
const { nastaviTorch } = await import('./src/lib/camera-capabilities')
const klici = []
const potrjen = { applyConstraints: async (c) => { klici.push(c) }, getCapabilities: () => ({ torch: true }), getContext: () => ({ torch: true }) }
const ugasnjen = { ...potrjen, getContext: () => ({ torch: false }), applyConstraints: async (c) => { klici.push(c) } }
const brezStanja = { applyConstraints: async (c) => { klici.push(c) }, getCapabilities: () => ({ torch: true }) }
const pokano = { applyConstraints: async (c) => { klici.push(c); throw new Error('brskalnik zavrne') }, getCapabilities: () => ({ torch: true }) }
const nepodprto = { applyConstraints: async (c) => { klici.push(c) }, getCapabilities: () => ({}) }
const izp = {}
for (const [n, t, on] of [['potrjenOn', potrjen, true], ['potrjenOff', ugasnjen, false], ['brezStanja', brezStanja, true], ['pokano', pokano, true], ['nepodprto', nepodprto, true], ['niTracka', null, true]]) {
  izp[n] = await nastaviTorch(t, on)
}
console.log(JSON.stringify({ izp, kliciPogosti: klici.length }))
''')
if '_err' in B:
    bad(f'bun B: {B["_err"]}')
else:
    i = B['izp']
    chk(i['potrjenOn']['stanje'] == 'VKLOPLJEN' and i['potrjenOff']['stanje'] == 'IZKLOPLJEN', 'potrjen torch → VKLOPLJEN/IZKLOPLJEN')
    chk(i['brezStanja']['stanje'] == 'SPREJETO_BREZ_POTRDITVE' and 'potrjuje' in i['brezStanja']['sporocilo'], 'brez getContext → SPREJETO_BREZ_POTRDITVE (brez lažnega dokaza)')
    chk(i['pokano']['stanje'] == 'NAPAKA' and 'svetlobo' in i['pokano']['sporocilo'], 'napaka ukaza → NAPAKA z rešitvijo v sporočilu')
    chk(i['nepodprto']['stanje'] == 'NI_PODPRE' and i['niTracka']['stanje'] == 'NI_PODPRE', 'nepodprto/brez tracka → NI_PODPRE')
    chk(B['kliciPogosti'] == 4, 'applyConstraints klican samo 4× (štirje PODPRTI) — pri NI_PODPRE in niTracka NIKOLI')

# ═══ C) štetje kamer: nič lažnih trditev ════════════════════════════════════
print('── C) prestejVideoVhode: nezavarjen kontekst = brez podatka')
C = bun_js(r'''
const { prestejVideoVhode } = await import('./src/lib/camera-capabilities')
const dvi = [{ kind: 'videoinput', deviceId: 'a' }, { kind: 'videoinput', deviceId: 'b' }, { kind: 'audioinput', deviceId: 'c' }]
const brezId = [{ kind: 'videoinput', deviceId: '' }, { kind: 'videoinput' }]
console.log(JSON.stringify({
  varjen: prestejVideoVhode(dvi, true), nezavarjen: prestejVideoVhode(dvi, false),
  brezId: prestejVideoVhode(brezId, true), nic: prestejVideoVhode(null, true),
}))
''')
if '_err' in C:
    bad(f'bun C: {C["_err"]}')
else:
    chk(C['varjen'] == 2, 'dva video vhoda z deviceId → 2')
    chk(C['nezavarjen'] is None, 'nezavarjen kontekst → null (NI_DOKAZA, ne »0 kamer«)')
    chk(C['brezId'] == 0 and C['nic'] is None, 'vhodi brez deviceId se ne štejejo; brez seznama → null')

# ═══ D) osnutek PO SEJI: nobena tiha prepis ═════════════════════════════════
print('── D) measure-draft: seje po projekt/nalog (brez tihe prepisi)')
D = bun_js(IDB_MOCK + r'''
const { saveDraft, loadDraft, loadSeje, clearDraft, normalizirajZapis, sejaKljuc, razvrstiSeje, splosciSejo, MAX_SEJE } = await import('./src/lib/measure-draft')
const view = (n) => ({ key: 1, photoId: null, dataUrl: 'data:image/jpeg;base64,' + 'x'.repeat(n), imgW: 1600, imgH: 1200,
  quality: { brightness: 120, blurScore: 80, dark: false, bright: false, blurry: false, ok: true },
  points: [{ x: .1, y: .2 }, { x: .3, y: .4 }], calib: { px: 250, cm: 100 }, calibLocked: false })
let ura = 0
const snap = (p, w, phase, loc) => ({ projectId: p, workOrderId: w, mode: 'OGRAJA', phase, views: [view(20)], activeView: 0, location: loc, calibMethod: 'MARKER', type: 'OGRAJA', heightS: '100', note: '', maxTilt: 2 })
// --- ključi
const k1 = sejaKljuc({ projectId: 'p1', workOrderId: 'w1' })
const kBrez = sejaKljuc({ projectId: null, workOrderId: null })
// --- A: dve SEJI obstajata hkrati (neha bi bila tiha prepis)
const izpr = await saveDraft('u1', snap('p1', 'w1', 2, 'vhod'))
await new Promise((r) => setTimeout(r, 3)); ura += 1
const izdr = await saveDraft('u1', snap('p2', 'w2', 1, 'okno'))
const seje1 = await loadSeje('u1')
// --- nadgradnja ISTA seja (isti projekt+nalog) → ŠE VEDNO ena, a posodobljena
await new Promise((r) => setTimeout(r, 3))
await saveDraft('u1', snap('p1', 'w1', 4, 'vhod B'))
const seje2 = await loadSeje('u1')
const p1Seja = (await loadDraft('u1', 'p1/w1'))
// --- najnovejša brez ključa
const naj = await loadDraft('u1')
// --- IDOR: drug uporabnik ne vidi ničesar
const tuj = await loadDraft('u2')
// --- izbris samo ene seje
await clearDraft('u1', 'p2/w2')
const poIzbrisu = await loadSeje('u1')
// --- MAX_SEJE meja vrne izpadle
const vec = []
for (let i = 0; i < MAX_SEJE + 2; i++) { await new Promise((r) => setTimeout(r, 2)); vec.push((await saveDraft('u3', snap('p' + i, 'w' + i, 1, 'x'))).izpadle) }
const sejeU3 = await loadSeje('u3')
// --- LEGACY R486 zapis (razprostrt čez zapis) mora ostati bran
const legacy = { userId: 'u4', savedAt: '2026-01-01T00:00:00.000Z', projectId: 'stari', workOrderId: 'nal', mode: 'STOPNICE', phase: 3, views: [view(10)], activeView: 0, location: 'stopnice', calibMethod: 'MARKER' }
const legacyNormaliziran = normalizirajZapis(legacy)
const legacySploscen = splosciSejo('u4', legacyNormaliziran[0])
// --- prevelik osnutek → napaka, obstoječe seje ostanejo
let velikErr = ''
try { await saveDraft('u1', { ...snap('p9', 'w9', 1, 'x'), views: [view(9_000_000)] }) } catch (e) { velikErr = e.message }
const sejePoVelikem = await loadSeje('u1')
// --- prazen userId
let brezUser = ''
try { await saveDraft('', snap('p', 'w', 1, 'x')) } catch (e) { brezUser = e.message }
const nic = await loadDraft('')
await clearDraft('')
console.log(JSON.stringify({
  k1, kBrez, izpr, izdr,
  steviloSej: seje1.length, keysSej: seje1.map((s) => s.key),
  steviloPoNadgradnji: seje2.length, fazap1: p1Seja.phase, lokp1: p1Seja.location,
  najKey: naj.projectId + '/' + naj.workOrderId, najFaza: naj.phase,
  tujNil: tuj === null,
  keysPoIzbrisu: poIzbrisu.map((s) => s.key),
  zadnjiIzpadli: vec[vec.length - 1], skupajIzpadlih: vec.flat().length, stSejU3: sejeU3.length, maxSeje: MAX_SEJE,
  legacyKey: legacyNormaliziran[0].key, legacyFaza: legacySploscen.phase, legacyUserId: legacySploscen.userId,
  legacyRazvrst: razvrstiSeje(legacyNormaliziran).length,
  velikErr, stSejPoVelikem: sejePoVelikem.length,
  brezUser, nicNil: nic === null,
}))
''')
if '_err' in D:
    bad(f'bun D: {D["_err"]}')
else:
    chk(D['k1'] == 'p1/w1' and D['kBrez'] == 'brez-projekta/brez-naloga', 'sejaKljuc: projekt/nalog in brezyimeni par')
    chk(D['steviloSej'] == 2 and set(D['keysSej']) == {'p1/w1', 'p2/w2'}, 'DVE meritvi hkrati — druga NE prepriše prve (izziv izgube podatkov)')
    chk(D['steviloPoNadgradnji'] == 2 and D['fazap1'] == 4 and D['lokp1'] == 'vhod B', 'isti projekt/nalog → nadgradnja, ne tretja seja')
    chk(D['najKey'] == 'p1/w1' and D['najFaza'] == 4, 'loadDraft brez ključa vrne NAJNOVEJŠO sejo')
    chk(D['tujNil'], 'drug uporabnik na isti napravi NE vidi osnutkov (IDOR vezava)')
    chk(D['keysPoIzbrisu'] == ['p1/w1'], 'clearDraft(uid, key) pobriše SAMO to sejo — ostale ostanejo')
    chk(D['maxSeje'] == 6 and D['stSejU3'] == 6 and len(D['zadnjiIzpadli']) > 0, 'meja MAX_SEJE drži in VRNE izpadle ključe (UI jih pove)')
    chk(D['skupajIzpadlih'] == 2, 'presežnih sej je ravno toliko, kot jih je izpadlo')
    chk(D['legacyKey'] == 'stari/nal' and D['legacyFaza'] == 3 and D['legacyUserId'] == 'u4', 'LEGACY R486 osnutek je bran in sploščen (brez izgube ob posodobitvi)')
    chk(D['legacyRazvrst'] == 1, 'razvrstiSeje vrne stabilno 1 element za legacy')
    chk('8 MB' in D['velikErr'] and 'pogled' in D['velikErr'] and D['stSejPoVelikem'] == 1, 'prevelik osnutek → napaka Z REŠITVIJO, obstoječa seja nedotaknjena')
    chk('prijav' in D['brezUser'].lower() and D['nicNil'], 'prazen userId → napaka PRIJAVA, null pri branju, noop pri brisanju')

# ═══ E) status shranjevanja: prioriteta in resnica ══════════════════════════
print('── E) stanjeShranjevanja: korak-na-korak status (4 stanja + neskladje)')
E = bun_js(r'''
const { stanjeShranjevanja } = await import('./src/lib/offline')
const nic = { online: true, caka: 0, napake: 0, konflikti: 0 }
const e = (x) => stanjeShranjevanja(x)
console.log(JSON.stringify({
  napaka: e({ ...nic, napake: 2 }),
  neskladje: e({ ...nic, konflikti: 1, napake: 1 }),
  cakaOnline: e({ ...nic, caka: 1 }),
  cakaOffline: e({ ...nic, online: false, caka: 1 }),
  samoFoto: e({ ...nic, lokalno: 1 }),
  sinh: e({ ...nic, potrjeno: true }),
  telefon: e(nic),
}))
''')
if '_err' in E:
    bad(f'bun E: {E["_err"]}')
else:
    chk(E['napaka']['stanje'] == 'NAPAKA' and 'telefonu' in E['napaka']['opis'], 'napaka ima prvo prioriteto in pove, da je vsebina varna')
    chk(E['neskladje']['stanje'] == 'NESKLADJE', 'neskladje ima prioriteto nad napako (odločitev mora sprejeti človek)')
    chk('spodletel' in E['neskladje']['dejanje'], 'hkratna NAPAKA pošiljanja je zapisana v dejanju — nič se ne skrije')
    chk(E['cakaOnline']['stanje'] == 'CAKA_NA_SINHRONIZACIJO' and E['cakaOffline']['stanje'] == 'CAKA_NA_SINHRONIZACIJO', 'vrsta s čakanjem → ČAKA (online in offline)')
    chk('vrne' in E['cakaOffline']['opis'] or 'signal' in E['cakaOffline']['opis'], 'offline opis pove, kdaj se pošlje')
    chk(E['samoFoto']['stanje'] == 'CAKA_NA_SINHRONIZACIJO', 'samo lokalna fotografija (brez ops) je tudi čakanje')
    chk(E['sinh']['stanje'] == 'SINHRONIZIRANO' and E['telefon']['stanje'] == 'SHRANJENO_V_TELEFONU', 'potrjena → SINHRONIZIRANO; prazno → SHRANJENO V TELEFONU')
    chk(E['sinh']['dejanje'] is None and E['telefon']['dejanje'] is not None, 'zaključeno stanje nima dejanja, nedokončano ga ima')
    for k in ('napaka', 'neskladje', 'cakaOnline', 'sinh', 'telefon'):
        chk(E[k]['oznaka'] not in ('', None), f'oznaka za {k} je besedilo, ne koda')

# ═══ F) žičenje v UI ════════════════════════════════════════════════════════
print('── F) meritve-kamera: zmožnosti, bliskavica, status, seje')
def src (rel):
    try:
        # R537: veliki moduli so razbiti v podmapo (modul.tsx + modul/*) —
        # statični pregled velja za celo funkcionalnost, ne samo datoteko.
        p = os.path.join(REPO, rel)
        with open(p, encoding='utf-8') as f:
            besedilo = f.read()
        podmapa = p.rsplit('.', 1)[0]
        if os.path.isdir(podmapa):
            for ime in sorted(os.listdir(podmapa)):
                if ime.endswith(('.ts', '.tsx')):
                    with open(os.path.join(podmapa, ime), encoding='utf-8') as f:
                        besedilo += '\n' + f.read()
        return besedilo
    except Exception: return ''

kamera = src('src/components/roksal/modules/meritve-kamera.tsx')
nizi = [
    ('src/lib/camera-capabilities.ts', 'NI_DOKAZA', 'LIB: tri stanja zmožnosti'),
    ('src/lib/camera-capabilities.ts', 'SPREJETO_BREZ_POTRDITVE', 'LIB: torch brez dokaza'),
    ('src/lib/measure-draft.ts', 'MAX_SEJE', 'LIB: meja sej'),
    ('src/lib/measure-draft.ts', 'normalizirajZapis', 'LIB: branje legacy R486'),
    ('src/lib/offline.ts', 'SHRANJENO_V_TELEFONU', 'LIB: štiri statusna stanja'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'zmogljivostiKamere', 'KAMERA: zmožnosti se ugotovijo iz naprave'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'prestejVideoVhode', 'KAMERA: štetje kamer prek enumerateDevices'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'nastaviTorch', 'KAMERA: bliskavica prek dokazanega ukaza'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'preklopiSmer', 'KAMERA: preklop kamere'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'napisZmogljivosti', 'KAMERA: pošten napis zmožnosti'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'stanjeShranjevanja', 'KAMERA: statusna vrstica shranjevanja'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'getOfflineState', 'KAMERA: stanje vzeto iz vrste, ne iz domneve'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'loadSeje', 'KAMERA: več nedokončanih sej'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'sejaKljuc', 'KAMERA: seja po projekt/nalog'),
    ('src/components/roksal/modules/meritve-kamera.tsx', 'osnutekKljuc', 'KAMERA: ključ se računa iz trenutnega konteksta'),
]
for rel, needle, msg in nizi:
    chk(src(rel).find(needle) >= 0, msg)
chk('SHRANJENO_V_TELEFONU' not in kamera and 'stanjeShranjevanja' in kamera,
    'KAMERA: oznaka stanja pride iz lib-a, ne iz kopiranega niza (ena sama resnica)')

# ključno SEJE brisanje (ne vseslovanski clearDraft) — trije pozivi
pozivi = [ln.strip() for ln in kamera.splitlines() if 'clearDraft(' in ln and 'export' not in ln]
chk(len(pozivi) >= 3 and all(', ' in p.split('clearDraft(')[1] for p in pozivi),
    f'KAMERA: VSI clearDraft klici so ključni (seja), ne vseslovanski — {pozivi}')
chk('izpadle' in kamera and 'Najstarejši osnutek je izpadel' in kamera, 'KAMERA: izpadle seje so monterju POVEDENE')
chk('ključ se izračuna PRED resetAll' in kamera, 'KAMERA: ključ se izračuna pred resetAll (sicer bi bil tiho napačen)')
chk('return true' in kamera and 'const uspelo = await startCamera' in kamera, 'KAMERA: preklop sme trditi uspeh samo po dejanskem zagonu')
# noben nov npm paket, noben AI, noben zunanji API (issue #7 pravila)
lock = src('package.json')
for prepoved in ('@tensorflow', 'onnxruntime', 'opencv', 'mediasoup', 'huggingface'):
    chk(prepoved not in lock, f'BREZ nove odvisnosti: {prepoved}')

print(f'════ R508: {PASS}✓ / {FAIL}✗ ════')
sys.exit(1 if FAIL else 0)
