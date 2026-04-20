from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from mathion.config import settings

engine = create_engine(settings.database_url, echo=False)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def enable_sqlite_fk(engine):
    """Enable foreign key enforcement for SQLite."""
    if "sqlite" in str(engine.url):

        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_conn, connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()


enable_sqlite_fk(engine)
