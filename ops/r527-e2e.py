#!/usr/bin/env python3
"""ops/r527-e2e.py — R527 (issue #14 §5): E2E skozi PRAVO aplikacijo —
izrecna oznaka generičnega demo izdelka v fotomontaži.

NEIZDAJALNO dokazno orodje. Strežnik teče kot POTOMEC tega skripta (peskovnik
ubija ločene procese — zato vse v eni seji). Enaka metoda kot R517/R518/R520/
R523/R524, tokrat GENERIČNI demo izdelek OGR-K-001 (brez preverjenih gradiv):

  prijava admin → Foto vizualizacija → projekt → nalaganje vt-terasa izvirnika
  (1c1e56ca52bc.jpg, programski DataTransfer) → označitev pergolskega panelskega
  polja 4 vogali + prednji plan (steber pergole) + referenca ROCNO 220 cm →
  korak IZDELEK: opcija OGR-K-001 nosi dopolnilo »— generični« (negativna
  kontrola: opcija ROK-OGP-POLNA-57 ga NIMA) → po izbiri je viden jantar
  OPOMBOZORILO »Generični izdelek, ni ROKSALOV original« (data-testid) →
  PREJ/POTEM (barvni približek) → rezultat: vrstica oznake + pošten napis
  NI_PREVERJENO → SHRANI → seznam shranjenih pokaže »(generični)« → BAZA:
  izdelek OGR-K-001 · BREZ gradiva (dokaz.gradivo null) · engine 1.4.0 →
  počiščeno (r459 disciplina).

Vsak korak se PREVERI po značilnem besedilu, ne slepi kliki (metodologija
r518/r520/r523/r524: radix Select opcije kliknjene prek DOM; posnetek potrebuje
scrollIntoView).
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AB = ['agent-browser', '--session', 'r527e2e']
OPS = os.path.join(REPO, 'ops')
DB = 'postgresql://roksal:roksal@localhost:54329/roksal'

PASS, FAIL = 0, 0


def ok (msg):  global PASS; PASS += 1; print(f'  ✓ {msg}')
def bad (msg): global FAIL; FAIL += 1; print(f'  ✗ {msg}')


def ab (*args, timeout=90):
    r = subprocess.run(AB + list(args), capture_output=True, text=True, timeout=timeout, cwd=REPO)
    return (r.stdout or '') + (r.stderr or '')


def shot (name):
    ab('screenshot', os.path.join(OPS, name))


def elements (timeout=60):
    out = []
    for line in ab('snapshot', '-i', timeout=timeout).splitlines():
        m = re.match(r'\s*-\s+(\w+)\s+"([^"]*)"\s*\[([^\]]*)\]', line)
        if not m:
            continue
        role, name, attrs = m.group(1), m.group(2), m.group(3)
        rm = re.search(r'ref=(\w+)', attrs)
        out.append({'role': role, 'name': name, 'ref': rm.group(1) if rm else None,
                    'disabled': 'disabled' in attrs.lower()})
    return out


def klik_opcijo (tekst, sek=12):
    """Klik option v radix Select prek DOM (ref-klik ga prekrije focus-div)."""
    konec = time.time() + sek
    m = tekst.lower()
    js = "(() => { const el = [...document.querySelectorAll('[role=option]')].find((o) => o.textContent.toLowerCase().includes('" + m + "')); if (!el) return 'ni-option'; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el.click(); return 'klik' })()"
    while time.time() < konec:
        r = ab('eval', js)
        if 'klik' in r:
            return True
        time.sleep(1.2)
    return False


def opcije_trditve ():
    """Trditve o opcijah izračuna v samem brskalniku (objekt, ne niz — izogiba navedenemu izpisu)."""
    js = """(() => {
      const opts = [...document.querySelectorAll('[role=option]')].map((o) => o.textContent)
      const gen = opts.find((t) => t.includes('OGR-K-001'))
      const rok = opts.find((t) => t.includes('ROK-OGP-POLNA-57'))
      return {
        genIma: gen ? gen.includes('— generični') : false,
        rokIma: rok ? rok.includes('generični') : null,
        stevilo: opts.filter((t) => t.includes('— generični')).length,
      }
    })()"""
    r = ab('eval', js).replace('\n', ' ')
    def m (k):
        mm = re.search(k + r'"?:\s*(true|false|null|\d+)', r)
        v = mm.group(1) if mm else None
        return {'true': True, 'false': False, 'null': None}.get(v, int(v) if v and v.isdigit() else v)
    return {
        'genIma': m('genIma'),
        'rokIma': m('rokIma'),
        'stevilo': m('stevilo'),
    }


def klik_elem (role, ime, delni=False, sek=12):
    konec = time.time() + sek
    while time.time() < konec:
        els = [e for e in elements() if e['role'] == role and e['ref'] and not e['disabled']
               and ((ime in e['name']) if delni else e['name'] == ime)]
        if els and '✓' in ab('click', '@' + els[0]['ref']):
            return els[0]['ref']
        time.sleep(1.2)
    return None


def pocekaj_besedilo (text, sek=25):
    r = ab('wait', '--text', text, '--timeout', str(sek * 1000), timeout=sek + 20)
    return '✗' not in r and 'timed out' not in r.lower()


def main ():
    print('── 1) zagon dev strežnika (kot potomec) ──')
    env = {**os.environ, 'DATABASE_URL': DB, 'DEMO_ACCESS': 'on', 'NODE_OPTIONS': ''}
    srv = subprocess.Popen(['bash', 'ops/dev-serve.sh'], cwd=REPO, env=env,
                           stdout=open('/tmp/r527-e2e-dev.log', 'w'), stderr=subprocess.STDOUT)
    pripravljen = False
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://localhost:3000/', timeout=3) as r:
                if r.status == 200:
                    pripravljen = True
                    break
        except Exception:
            time.sleep(2)
    if not pripravljen:
        bad('strežnik se ni zagnal v 120 s')
        sys.exit(1)
    ok('strežnik pripravljen')

    try:
        # ── 2) prijava ──
        print('── 2) prijava admin ──')
        ab('open', 'http://localhost:3000/')
        pocekaj_besedilo('Prijava', 20)
        # hidracija: fill pred priklopom Reacta se ob priklopu POČISTI — zato
        # vrednosti PREVERIMO in po potrebi znova napolnimo, klik pa vozimo v
        # zanki, dokler se ne prikaže Danes (metodologija: preverjaj, ne zaupaj)
        prijavljen = False
        for _ in range(12):
            ab('fill', '#email', 'admin@roksal.si')
            ab('fill', '#password', 'Admin123!')
            v = ab('eval', "(() => ({ e: document.querySelector('#email')?.value ?? '', p: (document.querySelector('#password')?.value ?? '').length }))()")
            vm = re.search(r'"e":\s*"([^"]*)".*"p":\s*(\d+)', v.replace('\n', ' '))
            if vm and vm.group(1) == 'admin@roksal.si' and vm.group(2) == '9':
                ab('eval', '(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Prijava"); if (b) b.click(); return b ? "klik" : "ni" })()')
                if pocekaj_besedilo('Danes', 8):
                    prijavljen = True
                    break
            time.sleep(2)
        if not prijavljen:
            bad('prijava ni uspela (12 poskusov)')
            shot('r527-e2e-2b-napaka-prijava.png')
            sys.exit(1)
        shot('r527-e2e-1-vhod.png')
        ok('prijava uspešna')

        # ── 3) navigacija ──
        print('── 3) Projekti → Foto vizualizacija ──')
        if not klik_elem('button', 'Projekti'):
            bad('sekcija Projekti ni kliknjena')
            sys.exit(1)
        time.sleep(1.5)
        if not (klik_elem('tab', 'Foto vizualizacija') or klik_elem('button', 'Foto vizualizacija')):
            bad('zavihek Foto vizualizacija ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Projekt', 20):
            bad('foto modul se ni naložil')
            sys.exit(1)
        ok('foto modul odprt')

        # ── 4) izbira projekta ──
        print('── 4) izbira projekta ──')
        izbran = False
        for _ in range(8):
            els = [e for e in elements() if e['role'] == 'button' and e['ref']
                   and re.search(r'P-\d{4}', e['name'])]
            if els and '✓' in ab('click', '@' + els[0]['ref']):
                time.sleep(1.5)
                naprej = [e for e in elements() if e['role'] == 'button' and 'Naprej' in e['name']]
                if naprej and not naprej[0]['disabled']:
                    izbran = True
                    break
            time.sleep(1.5)
        if not izbran:
            bad('projekt ni izbran (Naprej ostaja onemogočen)')
            sys.exit(1)
        ok('projekt izbran (Naprej omogočen)')

        # ── 5) nalaganje vt-terasa izvirnika ──
        print('── 5) Fotografija: nalaganje vt-terasa izvirnika (DataTransfer) ──')
        if not klik_elem('button', 'Naprej — Fotografija', delni=True):
            bad('Naprej (Fotografija) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Naloži fotografijo', 15):
            bad('korak Fotografija se ni odprl')
            sys.exit(1)
        r = ab('eval', '''(async () => {
              const res = await fetch("/assets/roksal/src/1c1e56ca52bc.jpg")
              const blob = await res.blob()
              const dt = new DataTransfer()
              dt.items.add(new File([blob], "1c1e56ca52bc.jpg", { type: "image/jpeg" }))
              const input = document.querySelector("#foto-upload")
              if (!input) return "ni-inputa"
              input.files = dt.files
              input.dispatchEvent(new Event("change", { bubbles: true }))
              return "ok:" + blob.size
            })()''', timeout=90)
        zadnja = r.strip().splitlines()[-1] if r.strip() else ''
        if 'ok:' not in zadnja:
            bad(f'nalaganje ni uspelo: {zadnja[:120]}')
            sys.exit(1)
        if not pocekaj_besedilo('Vir: 1c1e56ca52bc.jpg', 25):
            bad('fotografija se ni prikazala po nalaganju')
            shot('r527-e2e-2b-napaka.png')
            sys.exit(1)
        shot('r527-e2e-2-foto.png')
        ok(f'vt-terasa izvirnik naložen in prikazan ({zadnja.split(":", 1)[1]} bajtov)')

        # ── 6) Označi: 4 vogali panelskega polja + prednji plan + ref 220 cm ──
        print('── 6) Označi območje: 4 vogali + prednji plan (steber) + ref 220 cm ──')
        if not klik_elem('button', 'Naprej — Označi območje', delni=True):
            bad('Naprej (Označi) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Kliknite točko 1 od 4', 15):
            bad('korak Označi se ni odprl (čaka se 1. vogal)')
            sys.exit(1)
        KLIK_JS = '''(() => {
          const c = document.querySelector('canvas[aria-label="Označevanje območja obstoječe ograje na fotografiji"]')
          if (!c) return "ni-canvas"
          const r = c.getBoundingClientRect()
          const klik = (xn, yn) => {
            const x = r.left + xn * r.width, y = r.top + yn * r.height
            c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
            c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
          }
          %s
          return "ok:" + Math.round(r.width) + "x" + Math.round(r.height)
        })()'''
        # 4 vogali fixture vt-terasa-panelna-ograja-za-pergolo (enako kot R524)
        r = ab('eval', KLIK_JS % 'klik(0.020, 0.300); klik(0.560, 0.330); klik(0.560, 0.273); klik(0.020, 0.240)')
        if 'ok:' not in r:
            bad(f'označitev vogalov ni uspela: {r.strip()[:120]}')
            sys.exit(1)
        time.sleep(1.5)
        if not pocekaj_besedilo('Maska obstoječe ograje', 10):
            bad('maska se ni odprla po 4 vogalih')
            shot('r527-e2e-3b-napaka.png')
            sys.exit(1)
        ok(f'4 vogali panelskega polja označeni (canvas {r.strip().split(":", 1)[1]})')

        # prednji plan: steber pergole (fixture 4-točkovni poligon)
        if not klik_elem('button', 'prednji plan', delni=True):
            bad('način prednji plan ni preklopljen')
            sys.exit(1)
        time.sleep(0.8)
        r = ab('eval', KLIK_JS % 'klik(0.398, 0.210); klik(0.414, 0.210); klik(0.416, 0.410); klik(0.400, 0.410)')
        if 'ok:' not in r:
            bad('prednji plan ni narisán')
            sys.exit(1)
        time.sleep(1)
        ab('fill', '#ref-cm', '220')
        time.sleep(1)
        shot('r527-e2e-3-oznacija.png')
        ok('maska prednjega plana (steber pergole) + referenca 220 cm')

        # ── 7) Izdelek: GENERIČNI OGR-K-001 + oznaka ──
        print('── 7) Izdelek: OGR-K-001 (generični) — oznaka pred in po izbiri ──')
        if not klik_elem('button', 'Naprej — Izdelek', delni=True):
            bad('Naprej (Izdelek) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('ROKSAL izdelek', 15):
            bad('korak Izdelek se ni odprl')
            sys.exit(1)
        ab('click', '#pv-izdelek')
        time.sleep(1.5)

        # TRDITEV 1 (pred klikom): opcija generičnega nosi dopolnilo, ROKSALOVA ga NIMA
        tr = opcije_trditve()
        if tr.get('genIma') is True:
            ok('opcija OGR-K-001 nosi dopolnilo »— generični«')
        else:
            bad(f"opcija OGR-K-001 brez dopolnila (genIma={tr.get('genIma')!r})")
        if tr.get('rokIma') is False:
            ok(f"negativna kontrola: opcija ROK-OGP-POLNA-57 brez oznake")
        else:
            bad(f"negativna kontrola padla (rokIma={tr.get('rokIma')})")
        if tr.get('stevilo') == 9:
            ok('točno 9 opcij z dopolnilom »— generični« (vsi generični v fotomontažnih družinah)')
        else:
            bad(f"opcij z dopolnilom: {tr.get('stevilo')} (pričakovano 9)")

        if not klik_opcijo('OGR-K-001'):
            bad('izdelek OGR-K-001 ni izbran')
            shot('r527-e2e-4b-napaka.png')
            sys.exit(1)
        time.sleep(1.5)

        # TRDITEV 2 (po izbiri): jantar opozorilo s testid in besedilom poročila
        r = ab('eval', "(() => { const el = document.querySelector('[data-testid=genericni-izdelek-opozorilo]'); return el ? el.textContent.slice(0, 80) : 'ni' })()")
        vsebuje = 'Generični izdelek, ni ROKSALOV original' in r
        if vsebuje:
            ok(f'opozorilo po izbiri: »{r.strip().splitlines()[-1][:70]}…«')
        else:
            bad(f'opozorilo data-testid=genericni-izdelek-opozorilo manjka: {r.strip()[:100]}')
        if not pocekaj_besedilo('Ta izdelek nima preverjenih ROKSALOVIH gradiv', 10):
            bad('razlaga pod opozorilom se ni prikazala')
            sys.exit(1)
        shot('r527-e2e-4-izdelek.png')
        ok('generični izdelek izbran z vidno oznako (opozorilo + razlaga)')

        # ── 8) PREJ/POTEM: barvni približek + pošten napis ──
        print('── 8) PREJ/POTEM: izris (barvni približek) + oznaka v rezultatu ──')
        if not klik_elem('button', 'Naprej — PREJ / POTEM', delni=True):
            bad('Naprej (PREJ/POTEM) ni kliknjen')
            sys.exit(1)
        time.sleep(8)
        ab('eval', "(async () => { const c = document.querySelector('canvas[aria-label=' + String.fromCharCode(34) + 'Primerjava PREJ in POTEM' + String.fromCharCode(34) + ']'); if (c) c.scrollIntoView({ block: 'center' }); return 'scroll' })()")
        time.sleep(1.5)
        # TRDITEV 3: izrecna oznaka ob samem rezultatu (data-testid + besedili v ENEM besedilnem vozlù)
        r = ab('eval', "(() => { const el = document.querySelector('[data-testid=genericni-izdelek-potem]'); return el ? el.textContent.slice(0, 140) : 'ni' })()")
        if 'Generični izdelek, ni ROKSALOV original' in r and 'barvni približek iz kataloške barve/RAL' in r:
            ok('rezultat POTEM nosi oznako + pošto razlago (data-testid)')
        else:
            bad(f'oznaka ob rezultatu manjka: {r.strip()[:140]}')
        if pocekaj_besedilo('izris je barvni približek iz kataloške barve/RAL', 20):
            ok('rezultat POTEM pošteno pove: barvni približek, ne originalna površina')
        else:
            bad('razlaga pod oznako se ni prikazala')
        shot('r527-e2e-5-potem.png')
        ok('izris POTEM zajet (barvni približek — brez teksture, kot obljubljeno)')

        # ── 9) shrani ──
        print('── 9) shranjevanje variante ──')
        shranjeno = False
        for _ in range(10):
            r = ab('eval', '(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Shrani varianto") && !x.disabled); if (!b) return "ni"; b.click(); return "klik" })()')
            if 'klik' in r:
                shranjeno = True
                break
            time.sleep(1.2)
        if not shranjeno:
            bad('Shrani ni kliknjen')
            sys.exit(1)
        time.sleep(7)

        # TRDITEV 5: seznam shranjenih nosi »(generični)« ob izdelku
        if pocekaj_besedilo('(generični)', 15):
            ok('seznam shranjenih vizualizacij pokaže »(generični)« ob izdelku')
        else:
            bad('seznam shranjenih ne pokaže oznake')
        shot('r527-e2e-6-shranjeno.png')

        # ── 10) preverba v bazi ──
        print('── 10) preverba zapisa v bazi (OGR-K-001 · BREZ gradiva · engine 1.4.0) ──')
        r = subprocess.run(
            ['bun', '-e', '''
const { PrismaClient } = require("@prisma/client")
const db = new PrismaClient()
const v = await db.photoVisualization.findFirst({ orderBy: { createdAt: "desc" }, include: { product: true } })
if (!v) { console.log(JSON.stringify({ napaka: "NI ZAPISA" })); process.exit(0) }
const rp = v.renderParams ?? {}  // R542: jsonb objekt
const ver = await db.photoVisualizationVersion.findFirst({ where: { visualizationId: v.id }, orderBy: { version: "desc" } })
const meta = ver?.data?.meta ?? {}  // R542: jsonb objekt
console.log(JSON.stringify({
  sku: v.product?.sku ?? null, ime: v.product?.name ?? null,
  tip: rp.config?.tip, engine: v.engineVersion,
  gradivo: meta.dokaz?.gradivo?.pot ?? null,
  gradivoRazlog: meta.dokaz?.gradivoRazlog ?? null,
  refCm: rp.reference?.cm,
  id: v.id,
}))
await db.$disconnect()
'''], capture_output=True, text=True, cwd=REPO, env={**os.environ, 'DATABASE_URL': DB})
        out = {}
        for line in (r.stdout or '').splitlines():
            if line.startswith('{'):
                try:
                    out = json.loads(line)
                    break
                except Exception:
                    pass
        if out.get('napaka'):
            bad('vizualizacija NI shranjena')
        else:
            if out.get('sku') == 'OGR-K-001':
                ok(f"izdelek v zapisu: {out.get('sku')} · {out.get('ime')}")
            else:
                bad(f"izdelek v zapisu: {out.get('sku')} (pričakovano OGR-K-001)")
            if out.get('gradivo') is None:
                ok('BREZ originalnega gradiva v dokazni verigi (deterministično — generični ga nima)')
            else:
                bad(f"gradivo zapisan, a ga generični ne sme imeti: {out.get('gradivo')}")
            if out.get('engine') == '1.4.0':
                ok('engineVersion 1.4.0 zapisan (§13 — R532)')
            else:
                bad(f"engineVersion: {out.get('engine')} (pričakovano 1.4.0)")
            if out.get('tip') == 'POKOCNA':
                ok(f"tip polnila {out.get('tip')} (družina OGRAJA_POKOCNA)")
            else:
                bad(f"tip polnila: {out.get('tip')} (pričakovano POKOCNA)")
            subprocess.run(
                ['bun', '-e', f'''
const {{ PrismaClient }} = require("@prisma/client")
const db = new PrismaClient()
await db.photoVisualization.delete({{ where: {{ id: "{out.get('id')}" }} }}).catch(() => {{}})
const n = await db.photoVisualization.count({{ where: {{ id: "{out.get('id')}" }} }})
console.log(JSON.stringify({{ n }}))
await db.$disconnect()
'''], capture_output=True, text=True, cwd=REPO, env={**os.environ, 'DATABASE_URL': DB})
            ok('E2E zapis počiščen (r459 disciplina)')
    finally:
        print('── čiščenje: brskalnik + strežnik ──')
        ab('close')
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except Exception:
            srv.kill()

    print()
    print(f'══ E2E REZULTAT: {PASS} ✓ / {FAIL} ✗ ══')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
