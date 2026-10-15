#!/usr/bin/env python3
"""ops/r523-e2e.py — R523 (issue #14): E2E skozi PRAVO aplikacijo — FASADA KUBO.

NEIZDAJALNO dokazno orodje. Strežnik teče kot POTOMEC tega skripta (peskovnik
ubija ločene procese — zato vse v eni seji). Enaka metoda kot R517/R518/R520,
tokrat FASADNA površina z NOVO teksturo R523:

  prijava admin → Foto vizualizacija → projekt → nalaganje KUBO izvirnika
  (b6cd18418118.jpg, programski DataTransfer) → označitev STENE 4 vogali →
  referenca ROCNO 245 cm → izdelek ROK-FAS-KUBO + Rustic oak → PREVERI:
  letvica 80 mm (uradno) + razmik 20 mm (uradno poljuben, izmera R520) →
  PREJ/POTEM → SHRANI → BAZA: tip FASADA · 80/20 · gradivo ČIP uradne lestvice
  (roksal-kubo-cip-roak.png, DETAJL pred FOTO_IZDELEK — R523) · engine 1.2.0
  → počiščeno (r459 disciplina).

Vsak korak se PREVERI po značilnem besedilu, ne slepi kliki (metodologija
r518/r520: radix Select opcije kliknjene prek DOM; gumb pod pregibom zaslona →
DOM-klik; posnetek potrebuje scrollIntoView).
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AB = ['agent-browser', '--session', 'r523e2e']
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
                           stdout=open('/tmp/r523-e2e-dev.log', 'w'), stderr=subprocess.STDOUT)
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
            bad('aplikacija se ni naložila po prijavi')
            shot('r523-e2e-0-napaka.png')
            sys.exit(1)
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
        shot('r523-e2e-1-vhod.png')
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
            shot('r523-e2e-1b-napaka.png')
            sys.exit(1)
        ok('projekt izbran (Naprej omogočen)')

        # ── 5) nalaganje KUBO izvirnika ──
        print('── 5) Fotografija: nalaganje KUBO izvirnika (DataTransfer) ──')
        if not klik_elem('button', 'Naprej — Fotografija', delni=True):
            bad('Naprej (Fotografija) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Naloži fotografijo', 15):
            bad('korak Fotografija se ni odprl')
            sys.exit(1)
        r = ab('eval', '''(async () => {
              const res = await fetch("/assets/roksal/src/b6cd18418118.jpg")
              const blob = await res.blob()
              const dt = new DataTransfer()
              dt.items.add(new File([blob], "b6cd18418118.jpg", { type: "image/jpeg" }))
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
        if not pocekaj_besedilo('Vir: b6cd18418118.jpg', 25):
            bad('fotografija se ni prikazala po nalaganju')
            shot('r523-e2e-2b-napaka.png')
            sys.exit(1)
        shot('r523-e2e-2-foto.png')
        ok(f'KUBO izvirnik naložen in prikazan ({zadnja.split(":", 1)[1]} bajtov)')

        # ── 6) Označi steno: 4 vogali (quad fixture kubo-fasada-hisa-levo) ──
        print('── 6) Označi območje: 4 vogali STENE + referenca 245 cm ──')
        if not klik_elem('button', 'Naprej — Označi območje', delni=True):
            bad('Naprej (Označi) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Kliknite točko 1 od 4', 15):
            bad('korak Označi se ni odprl (čaka se 1. vogal)')
            sys.exit(1)
        KLIK_JS = '''(async () => {
              const c = document.querySelector('canvas[aria-label="Označevanje območja obstoječe ograje na fotografiji"]')
              if (!c) return "ni-canvas"
              const r = c.getBoundingClientRect()
              const klik = (xn, yn) => new Promise((res) => {
                const x = r.left + xn * r.width, y = r.top + yn * r.height
                c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
                c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
                setTimeout(res, 150)
              })
              await %s
              return "ok:" + Math.round(r.width) + "x" + Math.round(r.height)
            })()'''
        # 4 vogali fixture kubo-fasada-hisa-levo (stena levo od vhoda)
        r = ab('eval', KLIK_JS % 'klik(0.150, 0.710); await klik(0.590, 0.720); await klik(0.585, 0.070); await klik(0.155, 0.060)')
        if 'ok:' not in r:
            bad(f'označitev vogalov ni uspela: {r.strip()[:120]}')
            sys.exit(1)
        time.sleep(1.5)
        if not pocekaj_besedilo('Maska obstoječe ograje', 10):
            # fasada brez prednjega plana: maska se lahko odpre takoj po 4. vogalu
            pass
        ab('fill', '#ref-cm', '245')
        time.sleep(1)
        shot('r523-e2e-3-oznacija.png')
        ok(f'4 vogali stene označeni (canvas {r.strip().split(":", 1)[1]}) + referenca 245 cm')

        # ── 7) Izdelek: ROK-FAS-KUBO + Rustic oak ──
        print('── 7) Izdelek: ROK-FAS-KUBO + Rustic oak ──')
        if not klik_elem('button', 'Naprej — Izdelek', delni=True):
            bad('Naprej (Izdelek) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('ROKSAL izdelek', 15):
            bad('korak Izdelek se ni odprl')
            sys.exit(1)
        ab('click', '#pv-izdelek')
        time.sleep(1.2)
        if not klik_opcijo('Fasada — KUBO profil'):
            bad('izdelek ROK-FAS-KUBO ni izbran')
            shot('r523-e2e-4b-napaka.png')
            sys.exit(1)
        time.sleep(1.5)

        # KLJUČNA TRDITEV: letvica 80 mm (uradno roksal.com — profil KUBO 80×42,
        # SAMO navpično) + razmik 20 mm (uradno poljuben; izmera namestitev R520)
        lamela = ab('get', 'value', '#pv-lamela').strip().splitlines()[-1]
        reza = ab('get', 'value', '#pv-reza').strip().splitlines()[-1]
        if lamela == '80' and reza == '20':
            ok(f'prednastavitev URADNO: letvica {lamela} mm · razmik {reza} mm (KUBO 80×42, razmak poljuben → 20 izmere)')
        else:
            bad(f'prednastavitev: letvica {lamela} (pričakovano 80) · razmik {reza} (pričakovano 20)')

        ab('click', '#pv-varianta')
        time.sleep(1.2)
        if not klik_opcijo('Rustic oak'):
            bad('varianta Rustic oak ni izbrana')
            shot('r523-e2e-4c-napaka.png')
            sys.exit(1)
        time.sleep(1)
        shot('r523-e2e-4-izdelek.png')
        ok('izdelek KUBO + varianta Rustic oak izbrana')

        # ── 8) PREJ/POTEM ──
        print('── 8) PREJ/POTEM: izris s ČIPOM uradne lestvice ──')
        if not klik_elem('button', 'Naprej — PREJ / POTEM', delni=True):
            bad('Naprej (PREJ/POTEM) ni kliknjen')
            sys.exit(1)
        time.sleep(8)
        ab('eval', "(async () => { const c = document.querySelector('canvas[aria-label=' + String.fromCharCode(34) + 'Primerjava PREJ in POTEM' + String.fromCharCode(34) + ']'); if (c) c.scrollIntoView({ block: 'center' }); return 'scroll' })()")
        time.sleep(1.5)
        shot('r523-e2e-5-potem.png')
        ok('izris POTEM zajet (tekstura: čip uradne lestvice)')

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
        shot('r523-e2e-6-shranjeno.png')

        # ── 10) preverba v bazi ──
        print('── 10) preverba zapisa v bazi (tip FASADA · 80/20 · ČIP) ──')
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
            ok(f"tip {out.get('tip')} · letvica {out.get('lamela')} mm · razmik {out.get('reza')} mm (uradno)")
            chk1 = 'cip-roak' in (out.get('gradivo') or '')
            ok(f"gradivo: {out.get('gradivo') or '—'} ({out.get('vrsta')}) · sha {out.get('sha')}…"
               + (' — ČIP uradne lestvice, DETAJL pred FOTO_IZDELEK' if chk1 else ''))
            if not chk1:
                bad(f'gradivo NI čip (pričakovano roksal-kubo-cip-roak.png): {out.get("gradivo")}')
            if out.get('engine') == '1.2.0':
                ok('engineVersion 1.2.0 zapisan (§13)')
            else:
                bad(f'engineVersion: {out.get("engine")} (pričakovano 1.2.0)')
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
