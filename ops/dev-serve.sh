#!/usr/bin/env bash
# R493: ločeni zagon dev strežnika (brez pipe na tee — SIGPIPE ubija next ob čistilnem session cleanup)
# R496: pot je zdaj relativna na repozitorij (bila je trdo zapisana /home/z/roksal iz starega peskovnika).
cd "$(dirname "$0")/.."
if [ -f env.sh ]; then source env.sh; fi
exec ./node_modules/.bin/next dev -p "${DEV_PORT:-3000}" >> dev.log 2>&1
