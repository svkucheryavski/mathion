# Developing Mathion

Mathion is a FastAPI + SQLAlchemy 2.0 + Alembic backend on **PostgreSQL 17**, with
a Svelte 5 frontend and a Go command-line tool (`cli/`) that installs and manages
deployments. To run Mathion on a server instead, see
[docs/self-hosting.md](docs/self-hosting.md).

## Prerequisites

- Docker (for the local Postgres) and Docker Compose
- Python 3.13 (as CI) with the backend virtualenv at `backend/.venv`, installed with CI's pins:
  `backend/.venv/bin/pip install -c backend/constraints.txt -e './backend[dev]'`
- Node 26 for the frontend (CI and the image build use Node 26)
- Go 1.24 for the `mathion` tool in `cli/` (as CI)

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

The frontend tests, the type check and the visual-design gate:

```bash
(cd frontend && npm test && npm run check)
zsh frontend/scripts/visual-refresh-gate.sh
```

The `mathion` tool's tests:

```bash
cd cli && go test ./...
```

## Where things are

- `backend/`: the API, database models and migrations.
- `frontend/`: the Svelte 5 web app.
- `cli/`: the `mathion` tool; `deploy/`: the installer and release keys.
- `docs/superpowers/specs/` and `docs/superpowers/plans/`: design specs and implementation plans.
- `docs/interactive-apps.md`: rules for interactive apps.
- `docs/backlog/`: known work not yet done.
- `PROJECT.md`: the original vision, kept for history.
