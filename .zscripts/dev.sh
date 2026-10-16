#!/bin/bash

# R500 — zagon roksal-railing-manager v peskovniku (boot prek /start.sh)
#
# Razliko od predloge (bun install → db:push → dev) ta skripta:
#   1. zažene embedded PostgreSQL :54329 (podatki v .pgdata, preživijo reset),
#      z avtomatskim padcem na svežo inicializacijo, če je .pgdata poškodovana;
#   2. pognа prisma migrate deploy (produkcijska pot, nikoli db:push);
#   3. seje seja SEED SAMO ČE je baza prazna (števci user == 0) — lokalno delo
#      uporabnika se s tem NE pobriše ob vsakem zagonu (R497: seed sicer pobriše
#      vseh 58 tabel);
#   4. zažene next dev na :3000 (dev.log v korenu projekta).
#
# Pomembno: /start.sh po obnovitvi iz repo.tar PREPIŠE .env na SQLite pot —
# ta skripta .env povrani na PostgreSQL URL (export ima prednost pred .env tudi
# v vseh nadaljnjih procesih).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export DATABASE_URL="postgresql://roksal:roksal@localhost:54329/roksal"
export DEMO_ACCESS="${DEMO_ACCESS:-on}"
export AUTH_RATE_MAX="${AUTH_RATE_MAX:-100000}"
export SESSION_SECRET="${SESSION_SECRET:-dev-session-secret-roksal-local}"
export API_KEY_PEPPER="${API_KEY_PEPPER:-dev-pepper-roksal-local}"
export ROKSAL_PROJECT_ROOT="$PROJECT_DIR"

# .env prepišejo start.sh (SQLite) in prazni demozagoni — vedno povrni na PG
cat > "$PROJECT_DIR/.env" <<EOF
DATABASE_URL=$DATABASE_URL
DEMO_ACCESS=$DEMO_ACCESS
AUTH_RATE_MAX=$AUTH_RATE_MAX
SESSION_SECRET=$SESSION_SECRET
API_KEY_PEPPER=$API_KEY_PEPPER
EOF

log() { echo "[$(date '+%H:%M:%S')] [roksal-dev] $*"; }

wait_port() { # port ime poskusi
        local port="$1" name="$2" tries="${3:-90}" i
        for ((i = 1; i <= tries; i++)); do
                ss -tln 2>/dev/null | grep -q ":${port} " && return 0
                sleep 1
        done
        log "TIMEOUT: $name (port $port) se ni odprl v ${tries}s"
        return 1
}

wait_http() { # url ime poskusi
        local url="$1" name="$2" tries="${3:-120}" i
        for ((i = 1; i <= tries; i++)); do
                if curl -s -o /dev/null --connect-timeout 2 --max-time 5 "$url"; then
                        return 0
                fi
                sleep 1
        done
        log "TIMEOUT: $name ($url) se ni odzval v ${tries}s"
        return 1
}

# ── 0. odvisnosti ──────────────────────────────────────────────────────────
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
        log "bun install (node_modules manjka)"
        bun install
else
        log "node_tools že prisotne — bun install (incremental)"
        bun install
fi

# ── 1. embedded PostgreSQL ─────────────────────────────────────────────────
log "zagon embedded PostgreSQL :54329"
# Dvojna vilica (dev-detach.py): daemon se odpne na PID 1 — preživi konec
# klica tudi ob ročnem zagonu iz agentove lupine (moravec peskovnika ubija
# potomce klica po drevesu; pravnuk s staršem PID 1 ni več v drevesu).
python3 "$SCRIPT_DIR/dev-detach.py" "$PROJECT_DIR" bash -c 'bun run db:up > .zscripts/db-up.log 2>&1'
if ! wait_port 54329 "PostgreSQL" 90; then
        log "PG se ni zagnal — .pgdata najverjetneje poškodovana; REINICIJALIZACIJA (podatki baze bodo obnovljeni iz migracij+seed)"
        pkill -f "dev-db.mjs" 2>/dev/null || true
        pkill -f "postgres" 2>/dev/null || true
        sleep 2
        rm -rf "$PROJECT_DIR/.pgdata"
        python3 "$SCRIPT_DIR/dev-detach.py" "$PROJECT_DIR" bash -c 'bun run db:up > .zscripts/db-up.log 2>&1'
        wait_port 54329 "PostgreSQL (svež)" 120 || exit 1
fi
log "PostgreSQL teče"

# ── 2. migracije (produkcijska pot) ────────────────────────────────────────
log "prisma generate + migrate deploy"
bunx prisma generate
bunx prisma migrate deploy || { log "migracije so PADLE — prekinjam zagon"; exit 1; }

# ── 3. seed samo, če je baza prazna ────────────────────────────────────────
USERS=$(node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(c=>{console.log(c);return p.\$disconnect()}).catch(()=>{console.log(-1);process.exit(0)})")
if ! echo "$USERS" | grep -qE '^[0-9]+$'; then
        log "števca uporabnikov ni bilo mogoče prebrati ($USERS) — prekinjam zagon"
        exit 1
fi
log "število uporabnikov v bazi: $USERS"
if [ "$USERS" = "0" ]; then
        log "prazna baza — poganjam celotno seed verigo (seed + r437…r495)"
        # R534 (issue #21 §1): izrecna potrditev destruktivnega semena (varovalo
        # prisma/seed-guard.cjs zavrne brez nje)
        SEED_CONFIRM=YES_DEMO_DATA bun run db:seed || { log "seed je PADel — prekinjam zagon"; exit 1; }
else
        log "baza ima podatke — seed PRESKOČEN (ohranjanje lokalnega dela)"
fi

# ── 4. Next.js dev :3000 ───────────────────────────────────────────────────
# R536: OOM utrdba — peskovnik ima 4 GB; next dev ob kompilaciji vseh 195 rut
# (RBAC sweep r440-smoke) zrase na ~3 GB anon-rss in ga jedrni OOM ubijalec
# ustrelti sredi testnega pasu (izmerjeno 2×: dmesg "Killed process
# next-server"). Omejitev V8 kopice prisili pogostejši GC — nekoliko
# počasnejši dev, a pas preživi. Turbopack (Rust) del ostane, zato je
# meja 1536 MB (skupaj z nativnim delom ≈ 2,5 GB vrh, pod pragom).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
log "zagon next dev na :3000 (NODE_OPTIONS=$NODE_OPTIONS)"
python3 "$SCRIPT_DIR/dev-detach.py" "$PROJECT_DIR" bash -c 'exec bun run dev'

if ! wait_http "http://localhost:3000/api/public/health" "Next.js dev" 180; then
        log "next dev se ni odzval — zadnjih 30 vrstic dev.log:"
        tail -30 "$PROJECT_DIR/dev.log" 2>/dev/null || true
        exit 1
fi

log "health: $(curl -s http://localhost:3000/api/public/health)"
log "roksal-railing-manager teče na :3000"

# Mini-services: mapa obstaja a je prazna (roksal ne potrebuje stranskih servisov)
log "konec zagona — procesi tečejo v ozadju"
exit 0
