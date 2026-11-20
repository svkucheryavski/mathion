"""Math plan Task 5: the migration fills answer_options.text_html with the
escaped text, so existing choices show exactly as before."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from mathion.database import engine
from mathion.markdown import render_option_text
from mathion.models import AnswerOption

BEFORE = "d9a4c2e7f1b3"
PLAIN = "a<b & \"c\" > 'd'"


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def _migrate_again(db, *statements):
    """Step back before the migration, run the statements there, and come back."""
    db.close()
    command.downgrade(_cfg(), BEFORE)
    try:
        with engine.begin() as conn:
            for s in statements:
                conn.execute(s)
    finally:
        command.upgrade(_cfg(), "head")
    db.expire_all()


def test_migration_fills_text_html_with_the_escaped_text(admin_client, db):
    course = admin_client.post("/api/courses", json={"slug": "mig", "name": "M", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{v['id']}/blocks", json={"title": "B", "info": ""}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Q", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{item['id']}/questions",
                          json={"text_md": "x", "type": "single_choice"}).json()
    _migrate_again(  # the option row in old-schema SQL
        db,
        text("INSERT INTO answer_options (id, question_id, text, is_correct, \"order\") "
             "VALUES (907, :q, :t, true, 1)").bindparams(q=q["id"], t=PLAIN),
        text("INSERT INTO answer_options (id, question_id, text, is_correct, \"order\") "
             "VALUES (908, :q, '$x$', false, 2)").bindparams(q=q["id"]),
    )
    assert db.get(AnswerOption, 907).text_html == "a&lt;b &amp; \"c\" &gt; 'd'"
    assert db.get(AnswerOption, 907).text_html == render_option_text(PLAIN)   # same as a re-save
    assert db.get(AnswerOption, 908).text_html == "$x$"                      # no typesetting until a save
    col = next(c for c in inspect(engine).get_columns("answer_options") if c["name"] == "text_html")
    assert col["nullable"] is False and col["default"] is None


def test_downgrade_drops_the_column(db):
    db.close()
    try:
        command.downgrade(_cfg(), BEFORE)
        names = {c["name"] for c in inspect(engine).get_columns("answer_options")}
        assert "text_html" not in names
    finally:
        command.upgrade(_cfg(), "head")
