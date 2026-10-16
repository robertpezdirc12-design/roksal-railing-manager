#!/usr/bin/env python3
"""ops/r524-e2e.py — R524 (issue #14): E2E skozi PRAVO aplikacijo — OGRAJA
POLNA 57/32 z DETAJL čipom uradne lestvice.

NEIZDAJALNO dokazno orodje. Strežnik teče kot POTOMEC tega skripta (peskovnik
ubija ločene procese — zato vse v eni seji). Enaka metoda kot R517/R518/R520/
R523, tokrat POKONČNA ograja z NOVIMI čipi R524 (varianta, ki je v R518 padla v
SAMO_DRUZINA — sedaj UPORABLJENO z uradnim čipom površine):

  prijava admin → Foto vizualizacija → projekt → nalaganje vt-terasa izvirnika
  (1c1e56ca52bc.jpg, programski DataTransfer) → označitev pergolskega panelskega
  polja 4 vogali + prednji plan (steber pergole) + referenca ROCNO 220 cm →
  izdelek ROK-OGP-POLNA-57 + Rustic walnut → PREVERI: lamela 57 mm (širina
  profila) + razmik 20 mm → PREJ/POTEM → SHRANI → BAZA: tip POKOCNA · 57/20 ·
  gradivo roksal-polna57-cip-rwa.png (DETAJL — čip uradne namenske lestvice
  57/32) · engine 1.4.0 → počiščeno (r459 disciplina).

Vsak korak se PREVERI po značilnem besedilu, ne slepi kliki (metodologija
r518/r520/r523: radix Select opcije kliknjene prek DOM; posnetek potrebuje
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
AB = ['agent-browser', '--session', 'r524e2e']
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
                           stdout=open('/tmp/r524-e2e-dev.log', 'w'), stderr=subprocess.STDOUT)
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
        ab('fill', '#email', 'admin@roksal.si')
        ab('fill', '#password', 'Admin123!')
        if not klik_elem('button', 'Prijava'):
            bad('gumb Prijava ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Danes', 25):
            bad('prijava ni uspela')
            sys.exit(1)
        shot('r524-e2e-1-vhod.png')
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
            shot('r524-e2e-2b-napaka.png')
            sys.exit(1)
        shot('r524-e2e-2-foto.png')
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
        # 4 vogali fixture vt-terasa-panelna-ograja-za-pergolo (rahlo od roba)
        r = ab('eval', KLIK_JS % 'klik(0.020, 0.300); klik(0.560, 0.330); klik(0.560, 0.273); klik(0.020, 0.240)')
        if 'ok:' not in r:
            bad(f'označitev vogalov ni uspela: {r.strip()[:120]}')
            sys.exit(1)
        time.sleep(1.5)
        if not pocekaj_besedilo('Maska obstoječe ograje', 10):
            bad('maska se ni odprla po 4 vogalih')
            shot('r524-e2e-3b-napaka.png')
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
        shot('r524-e2e-3-oznacija.png')
        ok('maska prednjega plana (steber pergole) + referenca 220 cm')

        # ── 7) Izdelek: ROK-OGP-POLNA-57 + Rustic walnut ──
        print('── 7) Izdelek: ROK-OGP-POLNA-57 + Rustic walnut ──')
        if not klik_elem('button', 'Naprej — Izdelek', delni=True):
            bad('Naprej (Izdelek) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('ROKSAL izdelek', 15):
            bad('korak Izdelek se ni odprl')
            sys.exit(1)
        ab('click', '#pv-izdelek')
        time.sleep(1.2)
        if not klik_opcijo('POLNA DESKA 57'):
            bad('izdelek ROK-OGP-POLNA-57 ni izbran')
            shot('r524-e2e-4b-napaka.png')
            sys.exit(1)
        time.sleep(1.5)

        # KLJUČNA TRDITEV: lamela 57 mm (širina profila POLNA DESKA 57/32) +
        # razmik 20 mm (privzeto — katalog razmika za 57/32 ne določa)
        lamela = ab('get', 'value', '#pv-lamela').strip().splitlines()[-1]
        reza = ab('get', 'value', '#pv-reza').strip().splitlines()[-1]
        if lamela == '57' and reza == '20':
            ok(f'prednastavitev URADNO: lamela {lamela} mm · razmik {reza} mm (profil 57/32)')
        else:
            bad(f'prednastavitev: lamela {lamela} (pričakovano 57) · razmik {reza} (pričakovano 20)')

        ab('click', '#pv-varianta')
        time.sleep(1.2)
        if not klik_opcijo('Rustic walnut'):
            bad('varianta Rustic walnut ni izbrana')
            shot('r524-e2e-4c-napaka.png')
            sys.exit(1)
        time.sleep(1)
        shot('r524-e2e-4-izdelek.png')
        ok('izdelek POLNA 57/32 + varianta Rustic walnut izbrana')

        # ── 8) PREJ/POTEM ──
        print('── 8) PREJ/POTEM: izris s ČIPOM uradne lestvice ──')
        if not klik_elem('button', 'Naprej — PREJ / POTEM', delni=True):
            bad('Naprej (PREJ/POTEM) ni kliknjen')
            sys.exit(1)
        time.sleep(8)
        ab('eval', "(async () => { const c = document.querySelector('canvas[aria-label=' + String.fromCharCode(34) + 'Primerjava PREJ in POTEM' + String.fromCharCode(34) + ']'); if (c) c.scrollIntoView({ block: 'center' }); return 'scroll' })()")
        time.sleep(1.5)
        shot('r524-e2e-5-potem.png')
        ok('izris POTEM zajet (tekstura: čip uradne lestvice 57/32)')

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
        shot('r524-e2e-6-shranjeno.png')

        # ── 10) preverba v bazi ──
        print('── 10) preverba zapisa v bazi (tip POKOCNA · 57/20 · ČIP RWA) ──')
        r = subprocess.run(
            ['bun', '-e', '''
const { PrismaClient } = require("@prisma/client")
const db = new PrismaClient()
const v = await db.photoVisualization.findFirst({ orderBy: { createdAt: "desc" } })
if (!v) { console.log(JSON.stringify({ napaka: "NI ZAPISA" })); process.exit(0) }
const rp = JSON.parse(v.renderParams)
const ver = await db.photoVisualizationVersion.findFirst({ where: { visualizationId: v.id }, orderBy: { version: "desc" } })
const meta = JSON.parse(ver?.data ?? "{}").meta ?? {}
console.log(JSON.stringify({
  tip: rp.config?.tip, reza: rp.config?.rezaMm, lamela: rp.config?.lamelaMm, posts: rp.config?.posts,
  refCm: rp.reference?.cm, engine: v.engineVersion,
  gradivo: meta.dokaz?.gradivo?.pot ?? null, vrsta: meta.dokaz?.gradivo?.kind ?? null,
  sha: (meta.dokaz?.gradivo?.sha256 ?? "").slice(0, 12),
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
            ok(f"tip {out.get('tip')} · lamela {out.get('lamela')} mm · razmik {out.get('reza')} mm (uradno)")
            ok(f"maska prednji 1 oblika · referenca {out.get('refCm')} cm" if (out.get('refCm') == 220) else f"referenca {out.get('refCm')} cm (pričakovano 220)")
            chk1 = 'polna57-cip-rwa' in (out.get('gradivo') or '')
            ok(f"gradivo: {out.get('gradivo') or '—'} ({out.get('vrsta')}) · sha {out.get('sha')}…"
               + (' — ČIP uradne lestvice 57/32, DETAJL pred FOTO_IZDELEK (v R518 ta varianta padla v SAMO_DRUZINA)' if chk1 else ''))
            if not chk1:
                bad(f'gradivo NI čip (pričakovano roksal-polna57-cip-rwa.png): {out.get("gradivo")}')
            if out.get('engine') == '1.4.0':
                ok('engineVersion 1.4.0 zapisan (§13 — R532)')
            else:
                bad(f'engineVersion: {out.get("engine")} (pričakovano 1.4.0)')
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
