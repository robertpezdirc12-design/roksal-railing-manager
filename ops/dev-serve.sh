#!/usr/bin/env bash
# R493: ločeni zagon dev strežnika (brez pipe na tee — SIGPIPE ubija next ob čistilnem session cleanup)
cd /home/z/roksal
source env.sh
exec ./node_modules/.bin/next dev -p 3000 >> dev.log 2>&1
