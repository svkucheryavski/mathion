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


def test_progress_coverage_cell_math(admin_client, db):
    """One sequence with 3 static items. Student covered 2 of 3."""
    from mathion.models import Block, Sequence, Item, RunStudent
    from mathion.models_auth import User, UserItemState

    course = admin_client.post("/api/courses", json={"slug": "cov", "name": "Cov", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    items = [
        Item(sequence_id=seq.id, title=f"I{i}", slug=f"i{i}", order=i, type="static_page", content_md="x", content_html="x")
        for i in range(1, 4)
    ]
    db.add_all(items); db.flush()
    item_ids = [i.id for i in items]
    seq_id = seq.id
    db.commit()

    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, db, course["id"])

    student = User(email="cov@example.com", full_name="Cov S")
    db.add(student); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=None))
    db.add(UserItemState(user_id=student.id, item_id=item_ids[0], is_covered=True, time_spent=0))
    db.add(UserItemState(user_id=student.id, item_id=item_ids[1], is_covered=True, time_spent=0))
    db.add(UserItemState(user_id=student.id, item_id=item_ids[2], is_covered=False, time_spent=0))
    db.commit()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    assert r.status_code == 200
    body = r.json()
    assert len(body["students"]) == 1
    s = body["students"][0]
    assert s["email"] == "cov@example.com"
    assert s["coverage"] == [{"sequence_id": seq_id, "covered": 2, "total": 3}]
    assert s["quizzes"] == [{"sequence_id": seq_id, "correct": None, "total": None}]


def test_progress_quiz_cell_math(admin_client, db):
    """One sequence with 1 quiz item (multi-choice 2 of 4 correct).
    Student picks 1 of 2 correct -> cell {correct: 1, total: 2}."""
    from mathion.models import Block, Sequence, Item, Question, AnswerOption, RunStudent
    from mathion.models_auth import User, UserItemState

    course = admin_client.post("/api/courses", json={"slug": "qz", "name": "Qz", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    qi = Item(sequence_id=seq.id, title="Q", slug="q", order=1, type="quiz")
    db.add(qi); db.flush()
    q = Question(item_id=qi.id, text_md="?", text_html="<p>?</p>", type="multiple_choice", order=1)
    db.add(q); db.flush()
    o1 = AnswerOption(question_id=q.id, text="a", is_correct=True, order=1)
    o2 = AnswerOption(question_id=q.id, text="b", is_correct=False, order=2)
    o3 = AnswerOption(question_id=q.id, text="c", is_correct=True, order=3)
    o4 = AnswerOption(question_id=q.id, text="d", is_correct=False, order=4)
    db.add_all([o1, o2, o3, o4]); db.flush()
    seq_id = seq.id
    db.commit()

    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, db, course["id"])

    student = User(email="qz@example.com", full_name="Qz S")
    db.add(student); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=None))
    # Simulate post-Phase-7c stored values (option-level): 1/2
    db.add(UserItemState(user_id=student.id, item_id=qi.id, is_covered=True,
                         attempt_count=1, last_answers={str(q.id): [o1.id]},
                         last_score_correct=1, last_score_total=2, time_spent=0))
    db.commit()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    body = r.json()
    s = body["students"][0]
    assert s["coverage"][0] == {"sequence_id": seq_id, "covered": 1, "total": 1}
    assert s["quizzes"][0] == {"sequence_id": seq_id, "correct": 1, "total": 2}


def test_progress_quiz_cell_null_when_no_quiz_items(admin_client, db, seed_publishable_version):
    """Sequence with only static items: quiz cell is {correct: null, total: null}."""
    course, version = seed_publishable_version(slug="nq", name="NQ")
    run = _publish_run(admin_client, db, course["id"])

    from mathion.models import RunStudent
    from mathion.models_auth import User
    student = User(email="nq@example.com", full_name="NQ")
    db.add(student); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=None))
    db.commit()

    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/progress")
    body = r.json()
    s = body["students"][0]
    assert s["quizzes"][0]["correct"] is None
    assert s["quizzes"][0]["total"] is None
