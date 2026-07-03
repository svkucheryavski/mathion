from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.main import app
from mathion.models import (
    Block, Evaluation, Group, Item, MiniProject, RunStudent, RunTeacher, Sequence, Submission,
)
from mathion.models_auth import User
from tests.conftest import RUN_END_DATE_FAR

THREAD_URL = "/api/runs/{run}/dashboard/mini-projects/{mp}/groups/{group}/submissions"


def _publish_run(admin_client, course_id, groups_enabled=True):
    r = admin_client.post(f"/api/courses/{course_id}/runs", json={
        "title": "Run A", "start_date": "2026-01-01", "end_date": RUN_END_DATE_FAR,
        "groups_enabled": groups_enabled,
    }).json()
    admin_client.post(f"/api/runs/{r['id']}/teachers", json={"email": "t@example.com"})
    admin_client.post(f"/api/runs/{r['id']}/publish")
    return r


def _make_run_with_mp(admin_client, db, slug="thr"):
    """Published run + one MP (block 1) + two groups + one student in group 1."""
    course = admin_client.post(
        "/api/courses", json={"slug": slug, "name": slug, "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    block = Block(version_id=version["id"], title="B1", slug="b1", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, course["id"], groups_enabled=True)

    g1 = Group(run_id=run["id"], name="G1"); db.add(g1); db.flush()
    g2 = Group(run_id=run["id"], name="G2"); db.add(g2); db.flush()
    student = User(email=f"{slug}-s@example.com", full_name="Stu Dent"); db.add(student); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=student.id, group_id=g1.id))
    soft = datetime.now(timezone.utc) + timedelta(days=7)
    hard = datetime.now(timezone.utc) + timedelta(days=14)
    resub = datetime.now(timezone.utc) + timedelta(days=21)
    mp = MiniProject(
        run_id=run["id"], block_id=block.id, assignment_md="x", assignment_html="x",
        soft_deadline=soft, hard_deadline=hard, resubmission_deadline=resub, is_published=True,
    )
    db.add(mp); db.commit()
    return {"run": run, "g1": g1, "g2": g2, "student": student, "mp": mp, "block": block}


def _add_submission(db, mp_id, group_id, student_id, number, *, is_resubmission=False):
    sub = Submission(
        mini_project_id=mp_id, group_id=group_id, submitted_by=student_id,
        submitted_at=datetime.now(timezone.utc), file_path="x",
        submission_number=number, file_size=100 * number,
        is_late=False, is_resubmission=is_resubmission,
    )
    db.add(sub); db.flush()
    return sub


def _add_evaluation(db, submission_id, evaluator_id, result, *, feedback_file="fb.pdf",
                    score=None, feedback_text=None):
    ev = Evaluation(
        submission_id=submission_id, evaluated_by=evaluator_id, result=result,
        feedback_file=feedback_file, score=score, feedback_text=feedback_text,
    )
    db.add(ev); db.flush()
    return ev


def test_thread_newest_first_with_nested_eval(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="nf")
    sub1 = _add_submission(db, ctx["mp"].id, ctx["g1"].id, ctx["student"].id, 1)
    _add_evaluation(db, sub1.id, ctx["student"].id, "rejected", score=40, feedback_text="No")
    _add_submission(db, ctx["mp"].id, ctx["g1"].id, ctx["student"].id, 2, is_resubmission=True)
    db.commit()

    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 200
    subs = r.json()["submissions"]
    assert [s["submission_number"] for s in subs] == [2, 1]  # newest first
    assert subs[0]["evaluation"] is None                     # newest: awaiting
    assert subs[0]["is_resubmission"] is True
    assert subs[0]["submitted_by"]["full_name"] == "Stu Dent"
    assert subs[1]["evaluation"]["result"] == "rejected"
    assert subs[1]["evaluation"]["score"] == 40
    assert subs[1]["evaluation"]["evaluated_by"]["full_name"] == "Stu Dent"
    assert subs[1]["evaluation"]["has_feedback_file"] is True


def test_thread_empty_group_returns_empty_list(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="mt")
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g2"].id))
    assert r.status_code == 200
    assert r.json() == {"submissions": []}


def test_thread_only_target_group(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="og")
    _add_submission(db, ctx["mp"].id, ctx["g1"].id, ctx["student"].id, 1)
    _add_submission(db, ctx["mp"].id, ctx["g2"].id, ctx["student"].id, 1)
    db.commit()
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    subs = r.json()["submissions"]
    assert len(subs) == 1  # g2's submission is excluded (group scoping)
    assert subs[0]["submission_number"] == 1


def test_thread_403_for_student(admin_client, db, student_client_for):
    ctx = _make_run_with_mp(admin_client, db, slug="st")
    c = student_client_for(ctx["student"].email)
    r = c.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 403


def test_thread_403_for_unrelated_user(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="un")
    other = User(email="unrelated@example.com", full_name="Other"); db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})
    r = c.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 403


def test_thread_200_for_teacher(admin_client, db, teacher_user, teacher_client):
    ctx = _make_run_with_mp(admin_client, db, slug="te")
    db.add(RunTeacher(run_id=ctx["run"]["id"], user_id=teacher_user.id)); db.commit()
    r = teacher_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 200


def test_thread_403_for_teacher_of_another_run(admin_client, db, teacher_user, teacher_client):
    # IDOR: a teacher assigned to a DIFFERENT run must not read this run's thread.
    ctx = _make_run_with_mp(admin_client, db, slug="tar1")
    other = _make_run_with_mp(admin_client, db, slug="tar2")
    db.add(RunTeacher(run_id=other["run"]["id"], user_id=teacher_user.id)); db.commit()  # NOT ctx["run"]
    r = teacher_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 403


def test_thread_404_mp_not_in_run(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="m1")
    other = _make_run_with_mp(admin_client, db, slug="m2")  # mp belongs to another run
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=other["mp"].id, group=ctx["g1"].id))
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"


def test_thread_404_group_not_in_run(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="g1x")
    other = _make_run_with_mp(admin_client, db, slug="g2x")  # group belongs to another run
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=other["g1"].id))
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"


def test_thread_404_nonexistent_ids_are_probe_safe(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="ps")
    r = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=999999, group=ctx["g1"].id))
    assert r.status_code == 404
    assert r.json()["detail"] == "Resource not found"
    r2 = admin_client.get(THREAD_URL.format(run=ctx["run"]["id"], mp=ctx["mp"].id, group=999999))
    assert r2.status_code == 404
    assert r2.json()["detail"] == "Resource not found"
