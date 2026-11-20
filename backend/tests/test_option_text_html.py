"""Math plan Task 5: answer choices get text_html; publish and clone re-render
block info and options."""
from sqlalchemy import text

from mathion.markdown import render_markdown, render_option_text
from mathion.models import AnswerOption, Block


def test_render_option_text():
    assert render_option_text("a < b") == "a &lt; b"
    assert render_option_text(r"$\mu$ = 5").startswith("<math><semantics>")
    assert render_option_text(r"\$5") == "$5"
    assert "display" not in render_option_text("$$x$$")
    assert render_option_text("**b**") == "**b**"


def test_render_option_text_keeps_the_error_span_and_no_other_markdown():
    assert render_option_text(r"$\frac{1}$").startswith('<span class="math-error"')
    assert render_option_text("[a](b.pdf) <i>x</i>") == "[a](b.pdf) &lt;i&gt;x&lt;/i&gt;"
    assert render_option_text(r"\*") == "*"
    assert render_option_text("") == ""


def test_option_text_shares_the_dollar_rule():
    for plain in ("It costs $5 and $10", "$x$5", "$x$$y$", "US$5"):
        assert render_option_text(plain) == plain


def test_option_text_shows_a_broken_formula_as_typed():
    assert ">$$\\frac{1}$$</span>" in render_option_text(r"$$\frac{1}$$")
    assert ">$\\frac{1}$</span>" in render_option_text(r"$\frac{1}$")


def test_option_text_has_no_line_break_markup():
    assert "<br" not in render_option_text("a\\\nb")


def test_model_hook_sets_text_html():                 # no database needed
    o = AnswerOption(question_id=1, text="$x$", is_correct=True, order=1)
    assert "<math" in o.text_html
    o.text = "plain"
    assert o.text_html == "plain"


def _quiz(admin_client, info=""):
    course = admin_client.post("/api/courses", json={"slug": "oth", "name": "O", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": ""}).json()
    block = admin_client.post(f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": info}).json()
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"}).json()
    item = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Q", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{item['id']}/questions",
                          json={"text_md": "Pick", "type": "single_choice"}).json()
    r = admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "$x$", "is_correct": True})
    assert r.status_code == 201, r.text
    admin_client.post(f"/api/questions/{q['id']}/options", json={"text": "plain", "is_correct": False})
    return version, block, r.json()


def _stale(db, sql, **params):
    db.execute(text(sql), params)
    db.commit()
    db.expire_all()


def test_editor_create_option_fills_text_html(admin_client, db):
    _, _, opt = _quiz(admin_client)
    assert opt["text_html"] == render_option_text("$x$") and "<math" in opt["text_html"]
    assert db.get(AnswerOption, opt["id"]).text_html == opt["text_html"]


def test_editor_edit_option_rerenders_text_html(admin_client, db):
    _, _, opt = _quiz(admin_client)
    _stale(db, "UPDATE answer_options SET text_html = 'STALE' WHERE id = :i", i=opt["id"])
    r = admin_client.patch(f"/api/options/{opt['id']}", json={"text": r"$\mu$"})
    assert r.status_code == 200, r.text
    assert r.json()["text_html"] == render_option_text(r"$\mu$")
    assert db.get(AnswerOption, opt["id"]).text_html == render_option_text(r"$\mu$")


def _cloned(admin_client, db, version):
    r = admin_client.post(f"/api/versions/{version['id']}/duplicate", json={"label": "Copy"})
    assert r.status_code == 201, r.text
    return r.json()


def test_clone_rerenders_option_text_html(admin_client, db):
    version, _, opt = _quiz(admin_client)
    _stale(db, "UPDATE answer_options SET text_html = 'STALE' WHERE id = :i", i=opt["id"])
    new = _cloned(admin_client, db, version)
    got = db.execute(text(
        "SELECT o.text_html FROM answer_options o JOIN questions q ON q.id = o.question_id "
        "JOIN items i ON i.id = q.item_id JOIN sequences s ON s.id = i.sequence_id "
        "JOIN blocks b ON b.id = s.block_id WHERE b.version_id = :v ORDER BY o.\"order\""),
        {"v": new["id"]}).scalars().all()
    assert got == [render_option_text("$x$"), "plain"]


def test_publish_rerenders_option_text_html(admin_client, db):
    version, _, opt = _quiz(admin_client)
    _stale(db, "UPDATE answer_options SET text_html = 'STALE' WHERE id = :i", i=opt["id"])
    r = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert r.status_code == 200, r.text
    assert db.get(AnswerOption, opt["id"]).text_html == render_option_text("$x$")


def test_clone_rerenders_block_info(admin_client, db):
    version, block, _ = _quiz(admin_client, info="$x$")
    _stale(db, "UPDATE blocks SET info_html = 'STALE' WHERE id = :i", i=block["id"])
    new = _cloned(admin_client, db, version)
    nb = db.query(Block).filter(Block.version_id == new["id"]).one()
    assert nb.info_html == render_markdown("$x$") and "<math" in nb.info_html


def test_publish_rerenders_block_info(admin_client, db):
    version, block, _ = _quiz(admin_client, info="$x$")
    _stale(db, "UPDATE blocks SET info_html = 'STALE' WHERE id = :i", i=block["id"])
    r = admin_client.post(f"/api/versions/{version['id']}/publish")
    assert r.status_code == 200, r.text
    assert db.get(Block, block["id"]).info_html == render_markdown("$x$")


def test_student_content_options_carry_text_html(admin_client, db):
    version, _, opt = _quiz(admin_client)
    admin_client.post(f"/api/versions/{version['id']}/publish")
    data = admin_client.get(f"/api/versions/{version['id']}/content").json()
    options = data["blocks"][0]["sequences"][0]["items"][0]["questions"][0]["options"]
    assert options[0]["text_html"] == db.get(AnswerOption, opt["id"]).text_html
    assert "<math" in options[0]["text_html"] and "is_correct" not in options[0]


def test_math_surfaces(admin_client, db, seed_run_with_published_mp):
    course = admin_client.post("/api/courses", json={"slug": "ms", "name": "M", "description": ""}).json()
    v = admin_client.post(f"/api/courses/{course['id']}/versions", json={"label": "L", "info_md": "$v$"}).json()
    assert "<math" in v["info_html"]                                        # version info
    r = admin_client.post(f"/api/versions/{v['id']}/render", json={"content_md": "$x$"})
    assert "<math" in r.json()["html"]                                      # version preview
    block = admin_client.post(f"/api/versions/{v['id']}/blocks", json={"title": "B", "info": "$b$"}).json()
    assert "<math" in block["info_html"]                                    # block info
    seq = admin_client.post(f"/api/blocks/{block['id']}/sequences", json={"title": "S"}).json()
    page = admin_client.post(f"/api/sequences/{seq['id']}/items",
                             json={"title": "P", "type": "static_page", "content_md": "$p$"}).json()
    assert "<math" in page["content_html"]                                  # page save
    quiz = admin_client.post(f"/api/sequences/{seq['id']}/items", json={"title": "Q", "type": "quiz"}).json()
    q = admin_client.post(f"/api/items/{quiz['id']}/questions", json={
        "text_md": "$q$", "type": "single_choice", "explanation_md": "$e$"}).json()
    assert "<math" in q["text_html"] and "<math" in q["explanation_html"]  # question text + explanation
    run, _, _, mp = seed_run_with_published_mp(assignment_md="$a$")
    assert "<math" in mp["assignment_html"]                                 # mini-project assignment
    r = admin_client.post(f"/api/runs/{run['id']}/render", json={"content_md": "$y$"})
    assert "<math" in r.json()["html"]                                      # run preview


def test_publish_locks_the_questions_before_any_item_or_answer_row(admin_client, db):
    from sqlalchemy import event
    from mathion.database import engine
    version, _, opt = _quiz(admin_client)
    _stale(db, "UPDATE answer_options SET text_html = 'STALE' WHERE id = :i", i=opt["id"])
    _stale(db, "UPDATE items SET content_html = 'STALE' WHERE type = 'quiz'")
    seen = []
    def spy(conn, cursor, statement, params, context, executemany):
        seen.append(" ".join(statement.split()))
    event.listen(engine, "before_cursor_execute", spy)
    try:
        assert admin_client.post(f"/api/versions/{version['id']}/publish").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", spy)
    lock = next(i for i, q in enumerate(seen) if "FROM questions" in q and "FOR UPDATE OF questions" in q)
    assert "ORDER BY questions.id" in seen[lock]                # D12: ascending, as deletes and reorders
    first_item = next(i for i, q in enumerate(seen) if q.startswith("UPDATE items"))
    write = next(i for i, q in enumerate(seen) if q.startswith("UPDATE answer_options"))
    assert lock < first_item < write
