# tests/dbenv.py — R496: enoten vnos za bazo v testih, ki seed-ajo ali neposredno berejo.
#
# Zakaj: razvojni pas hraní povezavo v `env.sh` (nikoli v repozitoriju — .gitignore),
# CI pa jo podá z `TEST_DB_URL`. Testi, ki so brali SAMO env.sh, so v CI padli z
# "manjka DATABASE_URL iz env.sh"; testi, ki padejo na sistemski DATABASE_URL, lahko
# tiho seed-ajo na napačno bazo (npr. sqlite od predloge). Zato skupna veriga +
# eksplicitna zahteva po postgresql://.
#
# Prednost: TEST_DB_URL (izrecno) → env.sh (lokalni razvoj) → DATABASE_URL (sistemski).
import os


def _from_env_sh (repo_dir):
    path = os.path.join(repo_dir, 'env.sh')
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                if 'DATABASE_URL=' not in line or 'export' not in line:
                    continue
                value = line.split('=', 1)[1].strip()
                return value.strip('"').strip("'")
    except OSError:
        return None


def db_url (repo_dir):
    from_sh = _from_env_sh(repo_dir)
    url = os.environ.get('TEST_DB_URL') or from_sh or os.environ.get('DATABASE_URL') or ''
    if not url.startswith('postgresql://'):
        raise SystemExit(
            'Nedosegljiva testna baza: noben vir ni podal postgresql:// povezave '
            '(TEST_DB_URL → env.sh → DATABASE_URL). '
            'Lokalno: zaženi `bun run db:up` in `source env.sh`; '
            'v CI: nastavi TEST_DB_URL na postgres servis.'
        )
    return url


def seed_env (repo_dir):
    """Okolje za subprocess zagonov seedov (prisma/seed*.cjs)."""
    env = dict(os.environ)
    env['DATABASE_URL'] = db_url(repo_dir)
    return env
