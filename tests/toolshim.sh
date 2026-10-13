#!/usr/bin/env bash
# R497: skupno odkrivanje izvajalcev za testni pas (vir: tests/toolshim.sh)
#
# Zakaj: suite-i so pisani za Linux razvojno mizo in trdo kličejo `python3` in
# `bun`. Na drugem sistemu oba odpovesta na načina, ki PASTA ne opazita:
#   • `python3` je na Windows Git Bash lahko Microsoft Store alias, ki se NE
#     izvrši (natisne "Python ni bilo mogoče najti" in vrne 0) — `command -v`
#     torej NI zadosten preizkus;
#   • `bun` manjka, testje pa z njim poženejo enostavne JS-očiščevalke
#     (`subprocess.run(['bun', '-e', ...])`, 45 klicev), kar da WinError 2.
# Namesto da bi prepisali 45 klicev po 20 datotekah, pas dobri PATH ovojem:
# `python3` → dejanski interpreter, `bun` → `node` (isti JS, brez Bun-API-jev —
# preverjeno: v testih ni niti ene `Bun.*` uporabe).
#
# Namestitev odvisnosti NAMENSKO NI posnemana: `bun install/add/...` javi napako,
# ker bi `npm install` ustvaril package-lock.json in razsil bun.lock (kanonični
# hostilec repozitorija).
#
# Uporaba: source tests/toolshim.sh
#   $PY        izbrani Python (python3/python/py)
#   $JS_RUNNER izbrani JS-zagonilec (bun/node)
#   orodje_ima <ime>     0 če je orodje dejansko izvedljivo
#   preskoc_poroci       zbere sezname manjkajočih orodij (za skip poročilo)

orodje_ima () { # orodje_ima <ime> [args...] — 0 samo če se ukaz ZARES izvrši
  command -v "$1" >/dev/null 2>&1 || return 1
  if [ "$#" -gt 1 ]; then
    shift
    "$@" >/dev/null 2>&1 || return 1
  fi
  return 0
}

ozadje () { # ustvari ali prevzame mapo s PATH ovi
  # FIKSNA pot (ne mktemp): Windows `bun.exe` je 90 MB velika kopija node.exe,
  # ci-local pa poklice ci-matrix 22-krat — z mktemp bi vsaka skupina kopirala
  # 90 MB v /tmp. Mapo delijo skupine, vsebino pa vedno preverimo po velikosti,
  # da stale kopija ne prezivi nadgradnje node-a.
  OZADJE="${TOOLSHIM_DIR:-/tmp/roksal-toolshim}"
  mkdir -p "$OZADJE"
  export PATH="$OZADJE:$PATH"
  export OZADJE
}

# ── Python ───────────────────────────────────────────────────────────────────
PY=""
for kandidat in "${PY_KANDIDAT:-}" python3 python py; do
  [ -n "$kandidat" ] || continue
  if command -v "$kandidat" >/dev/null 2>&1 && "$kandidat" -c 'pass' >/dev/null 2>&1; then
    PY="$kandidat"; break
  fi
done
if [ -z "$PY" ]; then
  echo "✗ python: noben kandidat (python3/python/py) se ne zažene — namesti Python 3 in ponovi." >&2
  return 127 2>/dev/null || exit 127
fi
if [ "$PY" != python3 ]; then
  ozadje
  # -X utf8: na Windows privzeta cp1250 sicer zabrani tisk slovenskih/CJK znakov
  cat > "$OZADJE/python3" <<EOF
#!/bin/sh
exec "$PY" -X utf8 "\$@"
EOF
  chmod +x "$OZADJE/python3"
fi
export PY
# R497: UTF-8 za VSE Python suite-i, ne samo za `-X utf8` ovojnico. Na Windows
# je stdout cp1250, zato `print('✓ …')` ob KONCU suite-a vrže UnicodeEncodeError:
# register je že zapisan, pas pa skupino razglasi za rdečo. Izmerjeno prvič pri
# r440-smoke.py — del tistih 11 rdečih skupin je bil ta razlog, ne napaka
# aplikacije. PYTHONUTF8 dodatno velja še za `open()` / `read_text()`.
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

# ── JS zagonilec (bun → node) ────────────────────────────────────────────────
js_ovij_nas () { # 0 če `command -v` pokaže NAŠ ovi iz prejšnjega zagona, ne pravega bun-a
  # mapa se normalizira s `pwd -W` (Git Bash vrne C:/… ali /tmp/… za isto mapo);
  # na Linuxu `pwd -W` ne obstaja, takrat primerjanje preskoči in ostane samo
  # preverba markerja v shell-oviju.
  ovi="$(cd -- "${OZADJE:-${TOOLSHIM_DIR:-/tmp/roksal-toolshim}}" 2>/dev/null && pwd -W 2>/dev/null)"
  if [ -n "$ovi" ]; then
    m="$(cd -- "$(dirname -- "$1")" 2>/dev/null && pwd -W 2>/dev/null)"
    [ -n "$m" ] && [ "$m" = "$ovi" ] && return 0
  fi
  grep -qs 'node nadomestek za bun' -- "$1" && return 0
  return 1
}

JS_RUNNER=""
for kandidat in bun node; do
  pot="$(command -v "$kandidat" 2>/dev/null)" || pot=""
  [ -n "$pot" ] || continue
  # Izmerjeno na tej mizi: `ozadje` je zaradi Python-ovi že postavil
  # /tmp/roksal-toolshim na začetek PATH-a, tam je ostal `bun` prejšnjega zagona,
  # `command -v bun` ga je najdel in zagonilec je postal "bun" — kljub temu, da
  # bun ni nameščen. Posledica: NODE_OPTIONS s `@/` resolverjem se ni nastavil
  # in devet skupin je padlo na ERR_MODULE_NOT_FOUND.
  if js_ovij_nas "$pot"; then continue; fi
  if "$kandidat" -e 'process.stdout.write("ok")' >/dev/null 2>&1; then
    JS_RUNNER="$kandidat"; break
  fi
done
if [ -z "$JS_RUNNER" ]; then
  echo "✗ niti bun niti node se ne zaženeta — testa ne moreta očistiti baze." >&2
  return 127 2>/dev/null || exit 127
fi
if [ "$JS_RUNNER" = node ]; then
  [ -z "${OZADJE:-}" ] && ozadje
  cat > "$OZADJE/bun" <<'EOF'
#!/bin/sh
# node nadomestek za bun SAMO za izvajanje (ne za nameščanje odvisnosti)
case "$1" in
  install|add|remove|unlink|update|link)
    echo "✗ bun $1 je onemogočen v node-nadomestku: hostilec repozitorija je bun.lock." >&2
    echo "  Namesti bun (https://bun.sh) in pokliči znova — npm install bi pokvaril lockfile." >&2
    exit 2 ;;
  run)
    exec npm "$@" ;;
  -e)
    exec node -e "$2" ;;
  bunx|--help|-V|--version)
    if [ "$1" = bunx ]; then shift; exec npx "$@"; fi
    exec node --version ;;
  *)
    exec node "$@" ;;
esac
EOF
  cat > "$OZADJE/bunx" <<'EOF'
#!/bin/sh
exec npx "$@"
EOF
  chmod +x "$OZADJE/bun" "$OZADJE/bunx"
  # Windows: Python NI bash. `subprocess.run(['bun', …])` gre preko CreateProcess,
  # ki ime brez razširnice razširi na `ime.exe` — extensionless shell-ovija
  # torej NE more najti (izmerjeno: FileNotFoundError [WinError 2] pri 45 klicih,
  # kar je samo po sebi pomenilo 17 rdečih skupin). Zato naredimo `bun.exe` kot
  # kopijo node.exe. Bash ima v isti mapi raje
  # `bun` (shell-ovij, ki pozna `bun run`), nativni Python pa `bun.exe`;
  # oba vodita na node, kar je za te klice enako (`-e`, brez Bun API).
  case "$(uname -s 2>/dev/null)" in
    MING*|MSYS*|CYGWIN*)
      node_exe="$(command -v node.exe 2>/dev/null || command -v node 2>/dev/null)"
      if [ -n "$node_exe" ] && [ -f "$node_exe" ]; then
        # Trde veze (`mklink /H`, `ln`) Windows v Program Files vrže z
        # "Access is denied", zato je tu kopija — po velikosti preverjena, da
        # nadgrajen node ne pusti starega `bun.exe`.
        if [ ! -f "$OZADJE/bun.exe" ] ||
           [ "$(stat -c %s -- "$OZADJE/bun.exe" 2>/dev/null || echo 0)" != "$(stat -c %s -- "$node_exe")" ]; then
          cp -- "$node_exe" "$OZADJE/bun.exe" 2>/dev/null ||
            echo '⚠ windows: kopije bun.exe ni bilo mogoče ustvariti — Python suite-i bodo padli na WinError 2' >&2
        fi
      fi ;;
  esac
fi
# R497: Bun SAMODEJNO razreši tsconfig alias `@/…` in uvoze brez končnice
# (`import … from './src/lib/scene-understanding-core'`). Node teh ne pozna in
# javi ERR_MODULE_NOT_FOUND, kar se je v pasu poznalo kot SEDEM rdečih skupin
# (r467, r468, r469, r478, r480, r481, r485, r486, r487 berejo src/lib/*.ts in
# njihov izhod je bil prazen). Hook v `tests/ts-resolve-*.mjs` dopolni samo
# specifikatorje, ki bi sicer propsili — Buntovih API-jev ne posnema (`Bun.*` v
# testjih ni) in na Linuxu z `bun` se sploh ne naloži.
# Pot je relativna na koren repozitorija, ker suite-i tečejo od tam.
if [ "$JS_RUNNER" = node ]; then
  case "${NODE_OPTIONS:-}" in
    *ts-resolve-register*) : ;;
    *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import ./tests/ts-resolve-register.mjs" ;;
  esac
fi
export JS_RUNNER

# ── zunanja orodja, ki jih nadomestiti NE moremo varno ───────────────────────
# jq (JSON filtri v bash suite-ih), sqlite3 (r441 backup/restore) in ImageMagick
# (r440 generira PNG) so resnična sistemska orodja; njihova posnemitev bi dala
# lažne rezultate, zato ci-matrix prizadene teste označi kot PRESKOČENE.
#
# Pazi na `convert`: na Windows je to convert.exe (NTFS datotečni sistem!), ne
# ImageMagick — preverimo izpis, ne samo obstoja ukaza.
orodje_ok () { # orodje_ok <ime> — 0 če je orodje ZARES uporabno
  case "$1" in
    jq) orodje_ima jq && jq --version >/dev/null 2>&1 ;;
    sqlite3) orodje_ima sqlite3 && printf 'select 1;' | sqlite3 :memory: >/dev/null 2>&1 ;;
    openssl) orodje_ima openssl && openssl version >/dev/null 2>&1 ;;
    pdftotext) command -v pdftotext >/dev/null 2>&1 &&
      # `-v` piše na stderr in izstopa NE-nil (brez datotek) — šteje izpis, ne izhod
      pdftotext -v 2>&1 | grep -qi "poppler\|pdftotext" ;;
    imagick) { magick -version 2>/dev/null || convert -version 2>/dev/null; } | grep -qi imagemagick ;;
    *) orodje_ima "$1" ;;
  esac
}

orodja_za () { # orodja_za <datoteka> → orodja, ki jih ta suite res potrebuje
  case "$1" in
    r437.sh | r438.sh | r439.sh) echo jq ;;
    r440.sh) echo "jq imagick" ;;
    r441.sh) echo "jq sqlite3" ;;
    r477.py) echo "jq pdftotext" ;;
    r488.py) echo pdftotext ;;
  esac
}
