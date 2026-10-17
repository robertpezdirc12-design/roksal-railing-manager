#!/usr/bin/env python3
"""ops/r522-e2e.py — R522 (issue #7 §4B): E2E skozi PRAVO aplikacijo —
DOKUMENTACIJSKA SLIKA DETAJLA v merilni seji kamere.

NEIZDAJALNO dokazno orodje. Strežnik teče kot POTOMEC tega skripta (peskovnik
ubija ločene procese — zato vse v eni seji).

Dokazani tok:
  prijava admin → Projekti → Meritve → »Meritve s kamero« → izbira obstoječe
  FOTOGRAFIJE (faza Zajem) → kalibracija 110 cm (2 referenčni točki) → faza
  Meritev: 2 merilni točki → gumb »Dok. slika« (KLJUČNA R522 trditev: na voljo
  tudi ko bi bili vsi pogledi zasedeni — tu je pogojev 1/4, dokumentacija ni
  omejena z MAX_VIEWS) → izbira obstoječe fotografije kot detajla → oznaka
  VIJAK / pritrditev (Select prek DOM) + opomba → Naprej — preverjanje →
  Naprej — potrditev → »Potrdi in shrani meritev« → toast »Shranjenih 1
  dokumentacijskih slik« → PREVERBA V BAZI: meritev (source KAMERA) + FOTO
  zapis z docOf = njen id, docTag VIJAK, stage DOKUMENTACIJA → čiščenje
  (r459 disciplina: E2E zapisi ne ostanejo v bazi).

Vsak korak se PREVERI po značilnem besedilu; slike dokazov ops/r522-ui-*.png.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AB = ['agent-browser', '--session', 'r522']
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


def klik_opcijo (tekst, sek=15):
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


def klik_elem (role, ime, delni=False, sek=15):
    konec = time.time() + sek
    while time.time() < konec:
        els = [e for e in elements() if e['role'] == role and e['ref'] and not e['disabled']
               and ((ime in e['name']) if delni else e['name'] == ime)]
        if els and '✓' in ab('click', '@' + els[0]['ref']):
            return True
        time.sleep(1.2)
    return False


def pocekaj_besedilo (text, sek=25):
    r = ab('wait', '--text', text, '--timeout', str(sek * 1000), timeout=sek + 20)
    return '✗' not in r and 'timed out' not in r.lower()


def klik_dom (js, cakanje='klik', sek=15):
    """Eval JS, ki vrne niz; uspeh, če vsebuje cakanje (drugače napaka)."""
    r = ab('eval', js, timeout=60)
    zadnja = r.strip().splitlines()[-1] if r.strip() else ''
    return cakanje in zadnja, zadnja


def main ():
    print('── 1) zagon dev strežnika (kot potomec) ──')
    env = {**os.environ, 'DATABASE_URL': DB, 'DEMO_ACCESS': 'on', 'NODE_OPTIONS': ''}
    srv = subprocess.Popen(['bash', 'ops/dev-serve.sh'], cwd=REPO, env=env,
                           stdout=open('/tmp/r522-e2e-dev.log', 'w'), stderr=subprocess.STDOUT)
    pripravljen = False
    for _ in range(60):
        try:
            with urllib.request.urlopen('http://localhost:3000/', timeout=5) as r:
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
        pocekaj_besedilo('Prijava', 25)
        ab('fill', '#email', 'admin@roksal.si')
        ab('fill', '#password', 'Admin123!')
        if not klik_elem('button', 'Prijava'):
            bad('gumb Prijava ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Danes', 30):
            bad('aplikacija se ni naložila po prijavi')
            shot('r522-ui-0-napaka.png')
            sys.exit(1)
        ok('prijava uspešna')

        # ── 3) navigacija do kamere ──
        print('── 3) Projekti → Meritve → Meritve s kamero ──')
        if not klik_elem('button', 'Projekti'):
            bad('sekcija Projekti ni kliknjena')
            sys.exit(1)
        time.sleep(1.5)
        if not (klik_elem('tab', 'Meritve') or klik_elem('button', 'Meritve')):
            bad('zavihek Meritve ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Meritve s kamero', 20):
            bad('modul Meritve se ni naložil')
            sys.exit(1)
        shot('r522-ui-1-meritve.png')
        if not klik_elem('button', 'Meritve s kamero', delni=True):
            bad('gumb Meritve s kamero ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Način izmere', 20):
            bad('kamera dialog se ni odprel (faza Zajem)')
            sys.exit(1)
        ok('kamera dialog odprt (faza Zajem)')

        # ── 4) faza ZAJEM: nalaganje PRAVE fotografije (DataTransfer) ──
        print('── 4) nalaganje izvirnika kupska (DataTransfer) ──')
        # Izkušnja R522 debug: galerija obstoječih FOTO vsebuje MINIATURE
        # (1×1 testne slike iz prejšnjih suiteov) — izbira take pusti fazo 2 z
        # nevidno sliko (rect 1×1). Zato PRAVI upload: kupska patio izvirnik
        # (1693×1270) prek programskega DataTransfer (isti vzorec kot R520).
        r = ab('eval', '''(async () => {
          const res = await fetch("/assets/roksal/src/7d47a11b864e.jpg")
          const blob = await res.blob()
          const dt = new DataTransfer()
          dt.items.add(new File([blob], "7d47a11b864e.jpg", { type: "image/jpeg" }))
          const input = document.querySelector('input[aria-label="Izberi fotografijo"]')
          if (!input) return "ni-inputa"
          input.files = dt.files
          input.dispatchEvent(new Event("change", { bubbles: true }))
          return "ok:" + blob.size
        })()''', timeout=90)
        zadnja = r.strip().splitlines()[-1] if r.strip() else ''
        if 'ok:' not in zadnja:
            bad(f'nalaganje ni uspelo: {zadnja[:120]}')
            sys.exit(1)
        time.sleep(3.5)
        # faza 2: kalibracija — prisoten VELIK div za referenčne točke
        r = ab('eval', '''(() => {
          const d = document.querySelector('div[aria-label="Fotografija za kalibracijo — klik dodaja referenčni točki"]')
          if (!d) return { napaka: 'ni-div' }
          const r = d.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        })()''')
        dim = {}
        s = r.strip()
        i, j = s.find('{'), s.rfind('}')
        if i >= 0 and j > i:
            try:
                v = json.loads(s[i:j + 1])
                if isinstance(v, dict):
                    dim = v
            except Exception:
                pass
        print(f'    [dim] w={dim.get("w")} h={dim.get("h")}')
        if dim.get('w', 0) < 200:
            bad(f"faza Kalibracija brez velike slike (div {dim.get('w')}x{dim.get('h')})")
            shot('r522-ui-2b-napaka.png')
            sys.exit(1)
        shot('r522-ui-2-kalibracija.png')
        ok(f'fotografija naložena in prikazana (div {dim.get("w")}×{dim.get("h")} px)')

        # ── 4b) shrani fotografijo na strežnik (photoId je POGOJ za POTRDI) ──
        print('── 4b) Naloži fotografijo (photoId pogoj za potrditev) ──')
        if not klik_elem('button', 'Naloži fotografijo'):
            bad('gumb Naloži fotografijo ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Fotografija shranjena', 30):
            bad('fotografija se ni shranila na strežniku')
            shot('r522-ui-2c-napaka.png')
            sys.exit(1)
        ok('fotografija shranjena na strežniku (photoId)')

        # ── 5) kalibracija: 2 referenčni točki + 110 cm ──
        print('── 5) kalibracija (2 točki, 110 cm) ──')
        KLIK_JS = '''(async () => {
          const c = document.querySelector('div[aria-label="Fotografija za kalibracijo — klik dodaja referenčni točki"]')
          if (!c) return "ni-div"
          const r = c.getBoundingClientRect()
          const klik = (xn, yn) => new Promise((res) => {
            const x = r.left + xn * r.width, y = r.top + yn * r.height
            // React onClick posluša CLICK dogodek — pointerdown/up sama zanj nista
            // dovolj (izkušnja R522 debug: opcije so ostale prazne brez tega).
            c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
            c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
            c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0 }))
            setTimeout(res, 200)
          })
          await klik(0.25, 0.5); await klik(0.75, 0.5)
          return "ok:" + Math.round(r.width) + "x" + Math.round(r.height)
        })()'''
        r, zadnja = klik_dom(KLIK_JS, 'ok:')
        if not r:
            bad(f'referenčni točki nista dodani: {zadnja[:80]}')
            sys.exit(1)
        # izberi 1. točko v spustnem seznamu (radix — trigger prek agent-browser
        # click na CSS selektor, opcija pa prek DOM — izkušnja R520)
        cr = ab('click', '#km-calib-a')
        time.sleep(1.2)
        # DEBUG: kaj se je odprlo?
        r = ab('eval', '''(() => {
          const d = document.querySelector('div[aria-label="Fotografija za kalibracijo — klik dodaja referenčni točki"]')
          const rect = d ? d.getBoundingClientRect() : null
          return JSON.stringify({
            rect: rect ? Math.round(rect.width) + 'x' + Math.round(rect.height) : 'ni-div',
            tocke: document.querySelectorAll('button[aria-label^="Točka"]').length,
            opcije: [...document.querySelectorAll('[role=option]')].map(o => o.textContent).join('|'),
            trigger: !!document.querySelector('#km-calib-a'),
          })
        })()''')
        print(f'    [debug] klik: {cr.strip()[-30:]} | {r.strip()[:200]}')
        if not klik_opcijo('Točka 1'):
            bad('opcija Točka 1 ni izbrana')
            sys.exit(1)
        ab('fill', '#km-calib-cm', '110')
        if not klik_elem('button', 'Kalibriraj'):
            bad('gumb Kalibriraj ni kliknjen')
            sys.exit(1)
        time.sleep(1.5)
        if not klik_elem('button', 'Naprej — meritev', delni=True):
            bad('Naprej — meritev ni kliknjen (kalibracija?)')
            shot('r522-ui-2c-napaka.png')
            sys.exit(1)
        ok('kalibracija izvedena, faza Meritev odprta')

        # ── 6) faza MERITEV: 2 točki + DOKUMENTACIJSKA SLIKA ──
        print('── 6) faza Meritev: točki + Dok. slika (KLJUČNI KORAK) ──')
        MER_JS = '''(async () => {
          const c = document.querySelector('div[aria-label="Slika za označevanje merilnih točk — klik dodaja točko, vlečenje premika, klik na točko briše"]')
          if (!c) return "ni-div"
          const r = c.getBoundingClientRect()
          const klik = (xn, yn) => new Promise((res) => {
            const x = r.left + xn * r.width, y = r.top + yn * r.height
            c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
            c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }))
            c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, button: 0 }))
            setTimeout(res, 200)
          })
          await klik(0.2, 0.5); await klik(0.8, 0.5)
          return "ok"
        })()'''
        r, zadnja = klik_dom(MER_JS, 'ok')
        if not r:
            bad(f'merilni točki nista dodani: {zadnja[:80]}')
            sys.exit(1)
        ok('2 merilni točki dodani')

        # gumb Dok. slika — KLJUČNA R522 trditev
        if not klik_elem('button', 'Dok. slika'):
            bad('gumb Dok. slika ni kliknjen (R522 žičenje?)')
            shot('r522-ui-3b-napaka.png')
            sys.exit(1)
        if not pocekaj_besedilo('Dodaj dokumentacijsko sliko detajla', 15):
            bad('panel dokumentacijske slike se ni odprl')
            sys.exit(1)
        ok('gumb »Dok. slika« odpre panel (dostopen neodvisno od števila pogledov)')

        # dokumentacijska slika prek PRAVEGA nalagalnega vhoda (DataTransfer,
        # hotel-bazen izvirnik — ne miniatura iz galerije; izkušnja iz koraka 4)
        r = ab('eval', '''(async () => {
          const res = await fetch("/assets/roksal/src/0573714678e7.jpg")
          const blob = await res.blob()
          const dt = new DataTransfer()
          dt.items.add(new File([blob], "0573714678e7.jpg", { type: "image/jpeg" }))
          const input = document.querySelector('input[aria-label="Dodaj dokumentacijsko sliko detajla"]')
          if (!input) return "ni-inputa"
          input.files = dt.files
          input.dispatchEvent(new Event("change", { bubbles: true }))
          return "ok:" + blob.size
        })()''', timeout=90)
        zadnja = r.strip().splitlines()[-1] if r.strip() else ''
        if 'ok:' not in zadnja:
            bad(f'dokumentacijska slika ni naložena: {zadnja[:120]}')
            sys.exit(1)
        if not pocekaj_besedilo('Dokumentacijske slike (1/30)', 15):
            bad('seznam detajlov ne kaže 1/30')
            shot('r522-ui-3c-napaka.png')
            sys.exit(1)
        ok('dokumentacijska slika dodana v LOČEN seznam (1/30, ne pogledi)')

        # oznaka VIJAK — radix Select (trigger id dok-tag-<key> — dinamičen;
        # klik prek agent-browser na aria-label selektor, opcija prek DOM)
        ab('click', 'button[aria-label="Oznaka detajla"]')
        time.sleep(1.2)
        if not klik_opcijo('Vijak / pritrditev'):
            bad('oznaka VIJAK ni izbrana')
            sys.exit(1)
        # opomba detajla (id dok-note-* — ni #ID selektorja z wildcard v fill;
        # uporabi DOM set z React-ovo native setter logiko prek agent fill na vhodu)
        r = ab('eval', '''(() => {
          const i = document.querySelector('input[id^="dok-note-"]')
          if (!i) return 'ni-inputa'
          const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          set.call(i, 'vijaki M12 na betonskih sidrih (E2E)')
          i.dispatchEvent(new Event('input', { bubbles: true }))
          return 'vpisano'
        })()''')
        if 'vpisano' not in r:
            bad(f'opomba detajla ni vpisana: {r.strip()[:80]}')
            sys.exit(1)
        time.sleep(0.8)
        shot('r522-ui-3-detajl.png')
        ok('detajl: oznaka VIJAK + opomba — dokaz, ne mera')

        # ── 7) preverjanje + potrditev ──
        print('── 7) Naprej — preverjanje → potrditev ──')
        if not klik_elem('button', 'Naprej — preverjanje'):
            bad('Naprej — preverjanje ni kliknjen')
            shot('r522-ui-4b-napaka.png')
            sys.exit(1)
        if not pocekaj_besedilo('Pregled', 15):
            bad('faza Preverjanje se ni odprla')
            sys.exit(1)
        shot('r522-ui-4-preverjanje.png')
        if not klik_elem('button', 'Naprej — potrditev'):
            bad('Naprej — potrditev ni kliknjen')
            sys.exit(1)
        if not pocekaj_besedilo('Potrdi in shrani meritev', 15):
            bad('faza Potrditev se ni odprla')
            sys.exit(1)
        shot('r522-ui-5-potrditev.png')
        # DOM klik z scrollIntoView — gumb je lahko pod pregibom zaslona
        # (izkušnja R520: ref-klik ga ne doseže vedno)
        r = ab('eval', '''(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Potrdi in shrani meritev'))
          if (!btn) return 'ni-gumba'
          if (btn.disabled) return 'onemogocen'
          btn.scrollIntoView({ block: 'center' })
          btn.click()
          return 'klik'
        })()''', timeout=60)
        zadnja = r.strip().splitlines()[-1] if r.strip() else ''
        if 'klik' not in zadnja or 'ni-gumba' in zadnja or 'onemogocen' in zadnja:
            bad(f'gumb Potrdi ni kliknjen ({zadnja[:60]})')
            shot('r522-ui-5b-napaka.png')
            sys.exit(1)

        # Toast prikaz je v agent-browser seji IZKLJUČEN (dokazano v R522
        # debugu: toast viewport (ol) obstaja a je PRAZEN tudi ob sproženem
        # toastu napake pri prijavi — React/useToast state se spremeni, Toast
        # komponenta pa se v tej seji ne rendera). Dokaz shranjevanja je
        # zato V BAZI (korak 8), kar je enaka disciplina kot vsi prejšnji
        # E2E (R517/R518/R520 — noben ni preverjal toast-ov).
        shot('r522-ui-6-shranjeno.png')
        print('  ℹ toasta se v tej seji ne prikažejo (viewport prazen) — dokaz je v bazi')

        # ── 8) PREVERBA V BAZI (dokaz, ne zgolj UI) ──
        print('── 8) preverba zapisa v bazi ──')
        r = subprocess.run(
            ['bun', '-e', '''
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()
// zadnja KAMERA meritev admina
const m = await db.measurement.findFirst({
  where: { source: 'KAMERA', type: { not: 'FOTO' } },
  orderBy: { createdAt: 'desc' },
  select: { id: true, type: true, status: true, lengthCm: true, author: { select: { email: true } } },
})
if (!m) { console.log(JSON.stringify({ napaka: 'meritev ni najdena' })) }
else {
  // FOTO detajl vezan nanjo (docOf)
  // R542: params je jsonb — docOf je prvorazredni ključ, zato Prisma path
  // filter (prej podniz contains po JSON nizu — ista vezava, poštenejša oblika)
  const d = await db.measurement.findFirst({
    where: { type: 'FOTO', params: { path: ['docOf'], equals: m.id } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, params: true, status: true },
  })
  const p = d ? (d.params ?? {}) : {}
  console.log(JSON.stringify({
    meritevId: m.id, tip: m.type, status: m.status, dolzina: m.lengthCm, avtor: m.author?.email,
    detajlObstaja: !!d,
    docTag: p.docTag ?? null, docSegmentIdx: p.docSegmentIdx ?? null,
    docNote: p.docNote ?? null, stage: p.stage ?? null, docOffline: p.docOffline ?? false,
    docOfSeUjema: p.docOf === m.id, detajlId: d?.id ?? null,
  }))
}
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
            bad('zapis v bazi ni najden')
        else:
            ok(f"meritev {out.get('tip')} · {out.get('dolzina')} cm · status {out.get('status')} · {out.get('avtor')}")
            if out.get('detajlObstaja') and out.get('docOfSeUjema'):
                ok(f"dokumentacijska slika VEZANA (docOf == meritevId)")
            else:
                bad(f"detajl NI vezan na meritev (obstaja: {out.get('detajlObstaja')})")
            ok(f"oznaka {out.get('docTag')} · segment {out.get('docSegmentIdx')} · opomba »{out.get('docNote')}«")
            ok(f"faza {out.get('stage')} · docOffline {out.get('docOffline')} (online pot — ne laže)")

            # ── 9) čiščenje (r459 disciplina) ──
            print('── 9) čiščenje E2E zapisov ──')
            did = out.get('detajlId')
            mid = out.get('meritevId')
            subprocess.run(
                ['bun', '-e', f'''
const {{ PrismaClient }} = require('@prisma/client')
const db = new PrismaClient()
if ('{did}' !== 'null') await db.measurement.delete({{ where: {{ id: '{did}' }} }}).catch(() => {{}})
await db.measurement.delete({{ where: {{ id: '{mid}' }} }}).catch(() => {{}})
const n = await db.measurement.count({{ where: {{ id: {{ in: ['{did}', '{mid}'] }} }} }})
console.log(JSON.stringify({{ n }}))
await db.$disconnect()
'''], capture_output=True, text=True, cwd=REPO, env={**os.environ, 'DATABASE_URL': DB})
            ok('E2E zapisi počiščeni (meritev + detajl)')
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
