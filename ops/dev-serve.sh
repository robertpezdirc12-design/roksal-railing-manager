#!/usr/bin/env bash
# R493: ločeni zagon dev strežnika (brez pipe na tee — SIGPIPE ubija next ob čistilnem session cleanup)
# R496: pot je zdaj relativna na repozitorij (bila je trdo zapisana /home/z/roksal iz starega peskovnika).
# R502: `stop` — relejni pas (tests/ci-local.sh) operatorju svetuje naj ustavi
# zunanji strežnik; brez tega ukaza je bil nasvet lažen. Ustavi IZKLJUČNO
# poslušalca na svojih vratih, nikoli pa kakšnega drugega procesa.
cd "$(dirname "$0")/.."
if [ -f env.sh ]; then source env.sh; fi
PORT="${DEV_PORT:-3000}"

poslusalec () { # PID poslušalca na vratih (Linux `ss`, Windows/mac `netstat`)
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$1" \
      '$1 ~ /^TCP/ && index($2, p) && ($4 ~ /LISTEN/ || $3 ~ /^(0\.0\.0\.0:0|\[::]:0)$/) { print $NF; exit }'
  fi
}

if [ "${1:-}" = stop ]; then
  pid="$(poslusalec "$PORT")"
  if [ -z "$pid" ]; then echo "na vratih $PORT nihče ne posluša — ni kaj ustaviti"; exit 0; fi
  echo "ustavljam poslušalca na vratih $PORT (PID $pid in njegovo drevo)"
  case "$(uname -s 2>/dev/null)" in
    MING*|MSYS*|CYGWIN*) taskkill //PID "$pid" //T //F >/dev/null 2>&1 ;;
    *) kill -TERM "$pid" 2>/dev/null; sleep 1; kill -KILL "$pid" 2>/dev/null ;;
  esac
  # Potrditev, ne zaupanje: če vrata še vedno držijo, naj to ve operater.
  if [ -n "$(poslusalec "$PORT")" ]; then
    echo "✗ vrata $PORT še vedno držijo — ustavi proces ročno"
    exit 1
  fi
  echo "✓ vrata $PORT prosta"
  exit 0
fi

exec ./node_modules/.bin/next dev -p "$PORT" >> dev.log 2>&1
