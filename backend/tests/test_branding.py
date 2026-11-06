"""Branding D3, D12, D13: the site name rule, storage, and the one read that
never fails."""
import pytest

from mathion.branding import BrandingRefusal, check_site_name


@pytest.mark.parametrize("raw, stored", [
    ("  Riverside  ", "Riverside"),
    ("École", "École"),
    ("Mathe 🙂", "Mathe 🙂"),
    ("A\tB", "A B"),
    ("\u05d0\u200f\u05d1", "\u05d0\u200f\u05d1"),
    ("a\u200eb", "a\u200eb"),
    ("e\u0301cole", "\u00e9cole"),
    ("x" * 60, "x" * 60),
])
def test_name_accepted(raw, stored):
    assert check_site_name(raw) == stored


@pytest.mark.parametrize("raw", ["", "   ", "\t", "x" * 61, "a\nb", "a\r\nb", "a\u2028b", "a\u2029b", "a\u0085b"])
def test_name_refused_one_line(raw):
    with pytest.raises(BrandingRefusal, match=r"^The site name must be 1 to 60 characters on one line\.$"):
        check_site_name(raw)


@pytest.mark.parametrize("raw", ["\u200b\u200b", "a\u202eb", "a\u2066b", "a\u2069b", "a\x07b", "a\x1bb", "a\ud800b"])
def test_name_refused_hidden(raw):
    with pytest.raises(BrandingRefusal, match=r"^The site name has a hidden control character; type it again\.$"):
        check_site_name(raw)


# --- storage and the read that never fails (D12, D13) ---

import logging

from sqlalchemy import event
from sqlalchemy.pool import NullPool

from mathion import branding
from mathion.branding import (
    DEFAULT_BRANDING, BrandingUnavailable, ImageMeta, load_branding, read_image, short_hash,
)
from mathion.database import engine
from mathion.models_auth import SiteBranding, SiteBrandingImage, User


def _save(db, **values):
    db.add(SiteBranding(id=1, **values))
    db.commit()


def _session_without_tables():
    """Sessions on the real database whose search_path hides every table, so a
    read fails with a real UndefinedTable."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    bad = create_engine(engine.url, connect_args={"options": "-c search_path=pg_catalog"}, poolclass=NullPool)
    return sessionmaker(bind=bad)


def _session_refused():
    """Sessions whose connection is refused (a real OperationalError)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    bad = create_engine(engine.url.set(port=1), connect_args={"connect_timeout": 2}, poolclass=NullPool)
    return sessionmaker(bind=bad)


def test_load_branding_defaults_without_row(db):
    assert load_branding() == DEFAULT_BRANDING
    assert DEFAULT_BRANDING.name == "Mathion"
    assert DEFAULT_BRANDING.logo is None and DEFAULT_BRANDING.icon is None
    assert DEFAULT_BRANDING.theme_changes == {} and DEFAULT_BRANDING.theme_hash is None


def test_load_branding_reads_the_row(db):
    _save(db, site_name="Riverside", logo_width=838, logo_height=174, logo_hash="a" * 16,
          icon_width=180, icon_height=180, icon_hash="c" * 16, theme_changes={"--bg": "#fff"})
    b = load_branding()
    assert b.name == "Riverside"
    assert b.logo == ImageMeta(838, 174, "a" * 16)
    assert b.icon == ImageMeta(180, 180, "c" * 16)
    assert b.theme_changes == {"--bg": "#fff"}


def test_load_branding_without_table_gives_defaults(db, monkeypatch):
    monkeypatch.setattr(branding, "SessionLocal", _session_without_tables())
    assert load_branding() == DEFAULT_BRANDING


def test_load_branding_refused_connection_gives_defaults(db, monkeypatch):
    monkeypatch.setattr(branding, "SessionLocal", _session_refused())
    assert load_branding() == DEFAULT_BRANDING


def test_load_branding_logs_first_failure_after_startup(db, monkeypatch, caplog):
    monkeypatch.setattr(branding, "SessionLocal", _session_without_tables())
    with caplog.at_level(logging.WARNING, logger="mathion.branding"):
        load_branding()
        load_branding()
    assert len([r for r in caplog.records if r.name == "mathion.branding"]) == 1


def test_load_branding_keeps_last_good_on_error(db, monkeypatch, caplog):
    _save(db, site_name="Riverside")
    assert load_branding().name == "Riverside"
    real = branding.SessionLocal
    monkeypatch.setattr(branding, "SessionLocal", _session_refused())
    with caplog.at_level(logging.WARNING, logger="mathion.branding"):
        assert load_branding().name == "Riverside"
        assert load_branding().name == "Riverside"
        assert len([r for r in caplog.records if r.name == "mathion.branding"]) == 1
        # A success ends the outage; the next failure logs again.
        monkeypatch.setattr(branding, "SessionLocal", real)
        assert load_branding().name == "Riverside"
        monkeypatch.setattr(branding, "SessionLocal", _session_refused())
        assert load_branding().name == "Riverside"
        assert len([r for r in caplog.records if r.name == "mathion.branding"]) == 2


def test_load_branding_never_touches_caller_session(db, monkeypatch):
    db.add(User(email="kept@example.com", full_name="Kept"))
    db.flush()
    monkeypatch.setattr(branding, "SessionLocal", _session_without_tables())
    assert load_branding() == DEFAULT_BRANDING
    db.commit()
    assert db.query(User).filter_by(email="kept@example.com").count() == 1


def test_load_branding_answers_are_not_shared(db, monkeypatch):
    load_branding().theme_changes["--bg"] = "#000"
    assert DEFAULT_BRANDING.theme_changes == {}
    _save(db, theme_changes={"--bg": "#fff"})
    load_branding().theme_changes["--bg"] = "#000"
    monkeypatch.setattr(branding, "SessionLocal", _session_refused())
    assert load_branding().theme_changes == {"--bg": "#fff"}


def test_public_read_never_loads_image_bytes(db):
    _save(db, site_name="Riverside", logo_width=2, logo_height=1, logo_hash="b" * 16)
    db.add(SiteBrandingImage(kind="logo", data=b"\x89PNG..."))
    db.commit()
    seen: list[str] = []

    def record(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        load_branding()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert seen and not any("site_branding_images" in s for s in seen)


def test_read_image(db):
    assert read_image("logo") is None
    db.add(SiteBrandingImage(kind="logo", data=b"bytes"))
    db.commit()
    assert read_image("logo") == b"bytes"


def test_read_image_unavailable_on_error(db, monkeypatch):
    monkeypatch.setattr(branding, "SessionLocal", _session_refused())
    with pytest.raises(BrandingUnavailable):
        read_image("logo")


def test_short_hash():
    assert short_hash(b"x") == "2d711642b726b044"
    assert len(short_hash(b"")) == 16


def test_second_row_violates_check(db):
    from sqlalchemy.exc import IntegrityError
    db.add(SiteBranding(id=2))
    with pytest.raises(IntegrityError):
        db.commit()


# --- the default icon (D6) ---

def test_branding_defaults_match_files():
    import struct
    from pathlib import Path

    from mathion import branding_defaults

    folder = Path(__file__).resolve().parent.parent / "branding-defaults"
    assert branding_defaults.ICON_SVG == (folder / "icon.svg").read_bytes()
    for value, file, size in ((branding_defaults.ICON_32_PNG, "icon-32.png", 32),
                              (branding_defaults.ICON_180_PNG, "icon-180.png", 180)):
        assert value == (folder / file).read_bytes()
        assert value[:8] == b"\x89PNG\r\n\x1a\n" and value[12:16] == b"IHDR"
        assert struct.unpack(">II", value[16:24]) == (size, size)


# --- the theme fields (D10, D13) ---

def test_load_branding_theme_text(db):
    assert (load_branding().theme_text, load_branding().theme_hash) == ("", None)
    _save(db, theme_changes={"--bg": "#fff", "--gone": "#000", "--primary": "var(--radius)"})
    b = load_branding()
    assert b.theme_changes == {"--bg": "#fff"}
    assert b.theme_text == ":root:root {\n  --bg: #fff;\n}\n"
    assert b.theme_hash == short_hash(b.theme_text.encode())


def test_theme_bug_is_not_an_outage(db, monkeypatch, caplog):
    _save(db, site_name="Riverside", theme_changes={"--bg": "#fff"})

    def broken(stored):
        raise RuntimeError("parser bug")
    monkeypatch.setattr(branding, "changes_in_use", broken)
    with caplog.at_level(logging.WARNING):
        b = load_branding()
    assert b.name == "Riverside"
    assert (b.theme_changes, b.theme_text, b.theme_hash) == ({}, "", None)
    messages = [r.getMessage() for r in caplog.records]
    assert not any("database read failed" in m for m in messages)
    assert any("stored colours" in m for m in messages)
