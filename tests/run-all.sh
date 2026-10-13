#!/usr/bin/env bash
# R464: celoten regresijski suite (PostgreSQL).
#
# R496: seznam suite-ov je bil v tej datoteki DUPLICIRAN in je zaostal (ustavil se je
# pri r478, medtem ko je matrika štela 21+ skupin). Edini vir resnice je zdaj
# tests/ci-matrix.sh; ta skripta je tanek vmesnik zanjo — zastonj, ker jo poznajo
# dokumenti in stari ukazi. Za polni relejni pas (typecheck + lint + migracije +
# seed + aplikacija + matrika) uporabi tests/ci-local.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
exec bash tests/ci-matrix.sh --all
