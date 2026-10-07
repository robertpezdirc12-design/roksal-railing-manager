#!/usr/bin/env python3
"""ops/export-db.py — strojno berljiv JSON export vseh tabel (issue #3, točka 3).

Uporaba: python3 ops/export-db.py <pot-do-baze> <ciljna-mapa>
Izhod: <ciljna-mapa>/<tabela>.json za vsako tabelo + _meta.json s števci.

Namensko brez zunanjih odvisnosti (samo stdlib) — deluje tudi izključno iz
obnovljene kopije repozitorija (drill ne sme zahtevati namestitve)."""

import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone


def dumps(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=False, default=str)


def schema_fingerprint(conn: sqlite3.Connection) -> str:
    """SHA-256 prstni odtis sheme (CREATE stavki iz sqlite_master, abecedno)."""
    rows = conn.execute(
        "SELECT type, name, sql FROM sqlite_master "
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' "
        "ORDER BY type, name"
    ).fetchall()
    blob = "\n".join(r[2] for r in rows)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def table_names(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def main() -> int:
    if len(sys.argv) != 3:
        print("Uporaba: export-db.py <baza.db> <ciljna-mapa>", file=sys.stderr)
        return 2
    db_path, out_dir = sys.argv[1], sys.argv[2]
    if not os.path.isfile(db_path):
        print(f"NAPAKA: baza ne obstaja: {db_path}", file=sys.stderr)
        return 1
    os.makedirs(out_dir, exist_ok=True)

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        tables = table_names(conn)
        counts: dict[str, int] = {}
        for t in tables:
            rows = conn.execute(f'SELECT * FROM "{t}"').fetchall()  # noqa: S608 — ime iz sqlite_master
            data = [dict(r) for r in rows]
            counts[t] = len(data)
            with open(os.path.join(out_dir, f"{t}.json"), "w", encoding="utf-8") as fh:
                fh.write(dumps(data))

        meta = {
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "database": os.path.basename(db_path),
            "schemaFingerprint": schema_fingerprint(conn),
            "tableCount": len(tables),
            "rowCounts": counts,
        }
        with open(os.path.join(out_dir, "_meta.json"), "w", encoding="utf-8") as fh:
            fh.write(dumps(meta))

        print(dumps({"ok": True, **meta}))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
