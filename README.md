# Mathion

A learning-management backend (FastAPI + SQLAlchemy 2.0 + Alembic) on
**PostgreSQL 17**, with a Svelte 5 frontend.

## Prerequisites

- Docker (for the local Postgres) and Docker Compose
- Python 3.12+ with the backend virtualenv at `backend/.venv`

## Dev bootstrap

From the repository root:

```bash
# 1. Start the local Postgres (compose service `db`, matches the config default URL).
#    Run from the repo root, where docker-compose.yml lives.
docker compose up -d --wait db

# 2-4. The remaining commands run from the backend/ directory.
cd backend

# 2. Create the schema.
.venv/bin/alembic upgrade head

# 3. (optional) Seed demo data.
.venv/bin/python -m scripts.seed_demo

# 4. Run the app.
.venv/bin/uvicorn mathion.main:app --reload
```

Or use the dev runner scripts:

- `./run-debug.sh` — start Postgres, then the backend in developer mode (login PINs
  printed to stdout; assumes the schema already exists — run step 2 once first).
- `./run-dashboards-smoke.sh` — start Postgres, migrate, seed the teacher-dashboards
  smoke fixture, then serve. Assumes a clean database; to reset, drop the compose
  volume first: `docker compose down -v && docker compose up -d --wait db`.

## Configuration

Settings come from environment variables with the `MATHION_` prefix (e.g.
`MATHION_DATABASE_URL`, `MATHION_DEBUG`). The app does **not** read a `.env`
file — any `.env` is only for `docker compose` and for values you `export`
yourself. `database_url` defaults to the local docker Postgres
(`postgresql+psycopg://mathion:mathion@localhost:5432/mathion`) for zero-config
dev.

**In production, `MATHION_DATABASE_URL` is required.** If it is unset, the app
silently falls back to the localhost dev default (and fails loud with a
connection error). On startup the app logs its password-redacted database
target so a misconfigured deploy is visible in the logs.

## Tests

The suite runs against a dedicated `mathion_test` database on the same local
Postgres:

```bash
cd backend && .venv/bin/pytest -q
```
