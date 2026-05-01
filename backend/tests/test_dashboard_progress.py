from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.models import RunTeacher
from mathion.models_auth import User
from mathion.main import app


def _publish_run(admin_client, db, course_id, groups_enabled=False):
    r = admin_client.post(f"/api/courses/{course_id}/runs", json={
        "title": "Run A",
        "start_date": "2026-01-01",
        "end_date": "2026-12-31",
        "groups_enabled": groups_enabled,
    }).json()
    # publish requires at least one teacher
    admin_client.post(f"/api/runs/{r['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{r['id']}/publish")
    return r


def test_progress_404_for_nonexistent_run(admin_client):
    r = admin_client.get("/api/runs/99999/dashboard/progress")
    assert r.status_code == 404


def test_progress_403_for_unrelated_user(client, db, seed_publishable_version, admin_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])

    other = User(email="other@example.com", full_name="Other")
    db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})

    r = c.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 403


def test_progress_200_for_admin(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])
    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200


def test_progress_200_for_run_teacher(admin_client, seed_publishable_version, db, teacher_user, teacher_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    r = teacher_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200


def test_progress_sequences_shape_and_order(admin_client, db):
    """Two blocks with multiple sequences. Verify response.sequences is ordered by
    (block.order, sequence.order) with correct totals and quiz flag.

    Doesn't use seed_publishable_version because we need a custom block/sequence layout.
    """
    from mathion.models import Block, Sequence, Item, Question, AnswerOption

    course = admin_client.post("/api/courses", json={"slug": "p1", "name": "P1", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()

    # Block 1, two sequences. Sequence 1.1: 2 static + 1 quiz. Sequence 1.2: 1 static.
    b1 = Block(version_id=version["id"], title="B1", slug="b1", order=1)
    db.add(b1); db.flush()
    s11 = Sequence(block_id=b1.id, title="S11", slug="s11", order=1)
    s12 = Sequence(block_id=b1.id, title="S12", slug="s12", order=2)
    db.add_all([s11, s12]); db.flush()
    db.add(Item(sequence_id=s11.id, title="i1", slug="i1", order=1, type="static_page", content_md="x", content_html="x"))
    db.add(Item(sequence_id=s11.id, title="i2", slug="i2", order=2, type="static_page", content_md="x", content_html="x"))
    quiz_item = Item(sequence_id=s11.id, title="q1", slug="q1", order=3, type="quiz")
    db.add(quiz_item); db.flush()
    q = Question(item_id=quiz_item.id, text_md="2+2?", text_html="<p>2+2?</p>", type="single_choice", order=1)
    db.add(q); db.flush()
    db.add_all([
        AnswerOption(question_id=q.id, text="3", is_correct=False, order=1),
        AnswerOption(question_id=q.id, text="4", is_correct=True, order=2),
    ])
    db.add(Item(sequence_id=s12.id, title="i3", slug="i3", order=1, type="static_page", content_md="x", content_html="x"))

    # Block 2, one sequence with 1 item.
    b2 = Block(version_id=version["id"], title="B2", slug="b2", order=2)
    db.add(b2); db.flush()
    s21 = Sequence(block_id=b2.id, title="S21", slug="s21", order=1)
    db.add(s21); db.flush()
    db.add(Item(sequence_id=s21.id, title="i4", slug="i4", order=1, type="static_page", content_md="x", content_html="x"))
    db.commit()

    admin_client.post(f"/api/versions/{version['id']}/publish")

    # _publish_run takes course_id (per its signature in this file).
    run = _publish_run(admin_client, db, course["id"])

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
    body = r.json()

    assert len(body["sequences"]) == 3
    seqs = body["sequences"]
    assert seqs[0]["block_order"] == 1 and seqs[0]["sequence_order"] == 1
    assert seqs[0]["total_items"] == 3 and seqs[0]["has_quiz_items"] is True
    assert seqs[1]["block_order"] == 1 and seqs[1]["sequence_order"] == 2
    assert seqs[1]["total_items"] == 1 and seqs[1]["has_quiz_items"] is False
    assert seqs[2]["block_order"] == 2 and seqs[2]["sequence_order"] == 1
    assert seqs[2]["total_items"] == 1 and seqs[2]["has_quiz_items"] is False
