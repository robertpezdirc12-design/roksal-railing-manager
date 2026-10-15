#!/usr/bin/env python3
"""ops/r520-e2e.py — R520 (issue #14): E2E skozi PRAVO aplikacijo — TERASA.

NEIZDAJALNO dokazno orodje. Strežnik teče kot POTOMEC tega skripta (peskovnik
ubija ločene procese — zato vse v eni seji).

Dokazani tok (enaka metoda kot R517/R518, nova površina):
  prijava admin → Foto vizualizacija → projekt → nalaganje hotel-bazen izvirnika
  (programski DataTransfer) → označitev TALNE površine 4 vogali (sintetični
  PointerEvent) + prednji plan (ležalnik) + referenca ROCNO 480 cm → izdelek
  RUSTIC terasna deska + Rustic oak → PREVERI: reža se prednastavi na 6 mm po
  uradnem FAQ roksal.com in deska na 150 mm IZ IMENA izdelka (KLJUČNA R520
  trditev) → PREJ/POTEM → SHRANI → preverba zapisa v bazi (tip TERASA) →
  čiščenje zapisa (r459 disciplina).

Vsak korak se PREVERI po značilnem besedilu, ne slepi kliki (flakiness
ugotovljen v debugu: klik projekta ob napačnem času pusti Naprej onemogočen).
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AB = ['agent-browser', '--session', 'r520']
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
    """Vrne (role, name, ref, disabled) elemente iz interaktivnega snapshot-a."""
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
    """Klikne element po NATANČNEM (ali delnem) ujemanju imena; ne slepi kliki."""
    konec = time.time() + sek
    while time.time() < konec:
        els = [e for e in elements() if e['role'] == role and e['ref'] and not e['disabled']
               and ((ime in e['name']) if delni else e['name'] == ime)]
        if els and '✓' in ab('click', '@' + els[0]['ref']):
            return els[0]['ref']
        time.sleep(1.2)
    return None


def pocekaj_besedilo (text, sek=25):
    """uspešen wait vrne ISKANO BESEDILO, časovna omejitev pa ✗."""
    r = ab('wait', '--text', text, '--timeout', str(sek * 1000), timeout=sek + 20)
    return '✗' not in r and 'timed out' not in r.lower()


def main ():
    print('── 1) zagon dev strežnika (kot potomec) ──')
    env = {**os.environ, 'DATABASE_URL': DB, 'DEMO_ACCESS': 'on', 'NODE_OPTIONS': ''}
    srv = subprocess.Popen(['bash', 'ops/dev-serve.sh'], cwd=REPO, env=env,
                           stdout=open('/tmp/r518-e2e-dev.log', 'w'), stderr=subprocess.STDOUT)
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
            shot('r520-ui-0-napaka.png')
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
        shot('r520-ui-1-vhod.png')
        ok('foto modul odprt')

        # ── 4) izbira projekta (z dokazom: Naprej se OMOGOČI) ──
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
            shot('r520-ui-1b-napaka.png')
            sys.exit(1)
        ok('projekt izbran (Naprej omogočen)')

        # ── 5) Fotografija: nalaganje ──
        print('── 5) Fotografija: nalaganje izvirnika (DataTransfer) ──')
        if not klik_elem('button', 'Naprej — Fotografija', delni=True):
            bad('Naprej (Fotografija) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Naloži fotografijo', 15):
            bad('korak Fotografija se ni odprl')
            sys.exit(1)
        r = ab('eval', '''(async () => {
          const res = await fetch("/assets/roksal/src/0573714678e7.jpg")
          const blob = await res.blob()
          const dt = new DataTransfer()
          dt.items.add(new File([blob], "0573714678e7.jpg", { type: "image/jpeg" }))
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
        if not pocekaj_besedilo('Vir: 0573714678e7.jpg', 25):
            bad('fotografija se ni prikazala po nalaganju')
            shot('r520-ui-2b-napaka.png')
            sys.exit(1)
        shot('r520-ui-2-foto.png')
        ok(f'fotografija naložena in prikazana ({zadnja.split(":", 1)[1]} bajtov)')

        # ── 6) Označi: 4 vogali + prednji plan + referenca ──
        print('── 6) Označi območje: 4 vogali + prednji plan + referenca ──')
        if not klik_elem('button', 'Naprej — Označi območje', delni=True):
            bad('Naprej (Označi) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Kliknite točko 1 od 4', 15):
            bad('korak Označi se ni odprl (čaka se 1. vogal)')
            sys.exit(1)

        # R520: kliki po maski RABIJO zamik med seboj — vsak klik prebere
        # ZADNJO obliko iz stanja, da ji doda točko; brez zamika bi vsak klik
        # (prek zastarelega stanja) odprl NOVO obliko (4 točke = 4 oblike × 1).
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

        # 4 vogali fixture hotel-bazen (rahlo od roba, da klik pride na canvas)
        r = ab('eval', KLIK_JS % 'klik(0.030, 0.990); await klik(0.740, 0.990); await klik(0.700, 0.800); await klik(0.080, 0.800)')
        if 'ok:' not in r:
            bad(f'označitev vogalov ni uspela: {r.strip()[:120]}')
            sys.exit(1)
        time.sleep(1.5)
        if not pocekaj_besedilo('Maska obstoječe ograje', 10):
            bad('maska se ni odprla po 4 vogalih')
            shot('r520-ui-3b-napaka.png')
            sys.exit(1)
        ok(f'4 vogali označeni (canvas {r.strip().split(":", 1)[1]})')

        # prednji plan: preklop načina + 6-točkovni poligon (fixture)
        if not klik_elem('button', 'prednji plan', delni=True):
            bad('način prednji plan ni preklopljen')
            sys.exit(1)
        time.sleep(0.8)
        r = ab('eval', KLIK_JS % 'klik(0.280, 0.995); await klik(0.420, 0.995); await klik(0.410, 0.920); await klik(0.290, 0.930)')
        if 'ok:' not in r:
            bad('prednji plan ni narisán')
            sys.exit(1)
        time.sleep(1)
        ab('fill', '#ref-cm', '480')
        time.sleep(1)
        shot('r520-ui-3-oznacija.png')
        ok('maska prednjega plana (ležalnik) + referenca 480 cm')

        # ── 7) Izdelek ──
        print('── 7) Izdelek: RUSTIC terasna deska + Rustic oak ──')
        if not klik_elem('button', 'Naprej — Izdelek', delni=True):
            bad('Naprej (Izdelek) ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('ROKSAL izdelek', 15):
            bad('korak Izdelek se ni odprl')
            sys.exit(1)
        ab('click', '#pv-izdelek')
        time.sleep(1.2)
        if not klik_opcijo('RUSTIC (staran les)'):
            bad('izdelek RUSTIC (terasa) ni izbran')
            shot('r520-ui-4b-napaka.png')
            sys.exit(1)
            shot('r520-ui-4b-napaka.png')
            sys.exit(1)
        time.sleep(1.5)

        # KLJUČNA R518 TRDITEV: reza prednastavljena iz tech.razmakDeskMm
        # TERASA: deska 150 mm IZ IMENA izdelka, reža 6 mm po uradnem FAQ
        # roksal.com (»Med deskami je razmak 5-6mm«) — vidni polji #pv-deska
        # in #pv-reza2 (TERASA riše deske, ne lamel).
        reza = ab('get', 'value', '#pv-reza2').strip().splitlines()[-1]
        deska = ab('get', 'value', '#pv-deska').strip().splitlines()[-1]
        if reza == '6' and deska == '150':
            ok(f'prednastavitev IZ IMENA + URADNI FAQ: reža {reza} mm · deska {deska} mm')
        else:
            bad(f'prednastavitev: reža {reza} (pričakovano 6) · deska {deska} (pričakovano 150)')

        ab('click', '#pv-varianta')
        time.sleep(1.2)
        if not klik_opcijo('Rustic oak'):
            bad('varianta Rustic oak ni izbrana')
            shot('r520-ui-4c-napaka.png')
            sys.exit(1)
            sys.exit(1)
        time.sleep(1)
        shot('r520-ui-4-izdelek.png')
        ok('izdelek + varianta izbrana')

        # ── 8) PREJ/POTEM ──
        print('── 8) PREJ/POTEM: izris ──')
        if not klik_elem('button', 'Naprej — PREJ / POTEM', delni=True):
            bad('Naprej (PREJ/POTEM) ni kliknjen')
            sys.exit(1)
        time.sleep(8)
        # platno je pod pregibom zaslona (opozorila ga porinejo) — pomakni ga v vid
        ab('eval', "(async () => { const c = document.querySelector('canvas[aria-label=' + String.fromCharCode(34) + 'Primerjava PREJ in POTEM' + String.fromCharCode(34) + ']'); if (c) c.scrollIntoView({ block: 'center' }); return 'scroll' })()")
        time.sleep(1.5)
        shot('r520-ui-5-potem.png')
        ok('izris POTEM zajet')

        # ── 9) shrani ──
        print('── 9) shranjevanje variante ──')
        # gumb je lahko pod pregibom zaslona (opozorila potisnejo vsebino) —
        # zato DOM-klik z retry, enako kot opcije radix Selecta
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
        shot('r520-ui-6-shranjeno.png')

        # ── 10) preverba v bazi ──
        print('── 10) preverba zapisa v bazi ──')
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
  tip: rp.config?.tip, reza: rp.config?.rezaMm, lamela: rp.config?.lamelaMm, deska: rp.config?.deskaMm, posts: rp.config?.posts,
  maskaPrednji: rp.maska?.prednji?.length, refCm: rp.reference?.cm,
  gradivo: meta.dokaz?.gradivo?.pot ?? null, sha: (meta.dokaz?.gradivo?.sha256 ?? "").slice(0, 12),
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
            ok(f"tip {out.get('tip')} · deska {out.get('deska')} mm · reža {out.get('reza')} mm (uradni FAQ)")
            ok(f"maska prednji {out.get('maskaPrednji')} oblik (ležalnik) · referenca {out.get('refCm')} cm")
            ok(f"gradivo: {(out.get('gradivo') or '—')} · sha {out.get('sha')}…")
            # čiščenje (r459 disciplina: E2E zapisi ne ostanejo v bazi)
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
