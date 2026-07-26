# syntax=docker/dockerfile:1

# ---- Stage 1: build the Svelte SPA (arch-independent → build once, natively) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # → /build/dist

# ---- Stage 2: Python runtime serving API + SPA ----
FROM python:3.13-slim AS runtime

# Non-root user, fixed uid so a persisted named volume stays writable across
# image rebuilds.
RUN useradd -u 10001 -r -s /usr/sbin/nologin app

WORKDIR /app

# Install the app + runtime deps from pyproject (include=["mathion*"] ships only
# the package). Non-editable → lands in site-packages so `uvicorn mathion.main:app`
# and `python -m mathion.superuser` work.
COPY backend/pyproject.toml /tmp/backend/pyproject.toml
COPY backend/mathion /tmp/backend/mathion
RUN pip install --no-cache-dir /tmp/backend && rm -rf /tmp/backend

# Migration assets are excluded from the wheel — copy them separately, tree
# preserved, owned numerically (no build-order dependency on the `app` name).
# Two separate COPYs: a multi-source COPY would flatten alembic/ into /app/ and
# break script_location = %(here)s/alembic.
COPY --chown=10001:10001 backend/alembic.ini /app/alembic.ini
COPY --chown=10001:10001 backend/alembic/    /app/alembic/

# Built SPA + pin its path (the settings default resolves into site-packages).
COPY --from=frontend --chown=10001:10001 /build/dist /app/static
ENV MATHION_FRONTEND_DIST=/app/static

# Asset dir owned by app BEFORE any named volume attaches (a fresh named volume
# inherits the mountpoint's uid/gid on first init → writable by non-root app).
RUN mkdir -p /data/mathion/assets && chown -R 10001:10001 /data/mathion

USER app
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --retries=20 --start-period=10s \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status==200 else 1)"]
CMD ["uvicorn", "mathion.main:app", "--host", "0.0.0.0", "--port", "8000"]
