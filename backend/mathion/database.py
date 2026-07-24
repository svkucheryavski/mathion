from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from mathion.config import settings

# Pool + connection settings. `pool_pre_ping` survives dropped connections;
# `pool_recycle` pre-empts idle-connection reaping by hosts/proxies; `pool_timeout`
# bounds the wait on a saturated pool. `connect_args.options` pins the session
# timezone to UTC (app relies on UTC everywhere) and sets a generous server-side
# statement_timeout so a runaway query cannot pin a scarce connection. Size the
# pool small — managed hosts cap connections low, and the notification dispatcher
# forces a single worker when email is enabled (reserve +1 for its SessionLocal).
engine = create_engine(
    settings.database_url,
    echo=False,
    isolation_level="READ COMMITTED",  # A2: post-lock re-read depends on this; do not rely on server default
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=5,
    max_overflow=5,
    pool_timeout=30,
    connect_args={
        "connect_timeout": 10,
        "options": "-c statement_timeout=30000 -c TimeZone=UTC",
    },
)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
