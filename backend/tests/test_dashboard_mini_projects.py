from fastapi.testclient import TestClient

from mathion.auth import request_pin, verify_pin
from mathion.models import RunTeacher
from mathion.models_auth import User
from mathion.main import app


def _publish_run(admin_client, db, course_id, groups_enabled=True):
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


def test_mp_dashboard_404_for_nonexistent_run(admin_client):
    r = admin_client.get("/api/runs/99999/dashboard/mini-projects")
    assert r.status_code == 404


def test_mp_dashboard_403_for_unrelated_user(client, db, seed_publishable_version, admin_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])

    other = User(email="other2@example.com", full_name="Other")
    db.add(other); db.commit()
    raw = request_pin(db, other.email)
    tok = verify_pin(db, other.email, raw, duration_days=7)
    c = TestClient(app)
    c.cookies.set("session_token", tok)
    c.headers.update({"X-Requested-With": "mathion"})

    r = c.get(f"/api/runs/{run['id']}/dashboard/mini-projects")
    assert r.status_code == 403


def test_mp_dashboard_200_for_admin(admin_client, seed_publishable_version, db):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])
    r = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects")
    assert r.status_code == 200


def test_mp_dashboard_200_for_run_teacher(admin_client, seed_publishable_version, db, teacher_user, teacher_client):
    course, version = seed_publishable_version()
    run = _publish_run(admin_client, db, course["id"])
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    r = teacher_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects")
    assert r.status_code == 200


def _make_run_with_mp(admin_client, db, slug="mp"):
    """Create a published run with one MP (block 1) and one student in one group."""
    from datetime import datetime, timedelta, timezone

    from mathion.models import Block, Group, Item, MiniProject, RunStudent, Sequence
    from mathion.models_auth import User

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
    run = _publish_run(admin_client, db, course["id"], groups_enabled=True)

    g = Group(run_id=run["id"], name="G1")
    db.add(g); db.flush()
    s = User(email=f"{slug}@example.com", full_name="S")
    db.add(s); db.flush()
    db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=g.id))
    soft = datetime.now(timezone.utc) + timedelta(days=7)
    hard = datetime.now(timezone.utc) + timedelta(days=14)
    resub = datetime.now(timezone.utc) + timedelta(days=21)
    mp = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=soft, hard_deadline=hard, resubmission_deadline=resub,
        is_published=True,
    )
    db.add(mp); db.commit()
    return {"run": run, "group": g, "student": s, "mp": mp, "block": block}


def test_mp_dashboard_status_not_submitted(admin_client, db):
    ctx = _make_run_with_mp(admin_client, db, slug="ns")

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    assert len(body["mini_projects"]) == 1
    mp = body["mini_projects"][0]
    assert mp["counts"]["total_groups"] == 1
    assert mp["counts"]["not_submitted"] == 1
    assert mp["groups"][0]["status"] == "not_submitted"
    assert mp["groups"][0]["latest_submission"] is None
    assert mp["groups"][0]["latest_evaluation"] is None


def test_mp_dashboard_status_awaiting_eval(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Submission
    ctx = _make_run_with_mp(admin_client, db, slug="ae")
    db.add(Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )); db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "awaiting_eval"
    assert g["latest_submission"]["submission_number"] == 1
    assert g["latest_evaluation"] is None


def test_mp_dashboard_status_needs_revision(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Evaluation, Submission
    ctx = _make_run_with_mp(admin_client, db, slug="nr")
    sub = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=ctx["student"].id,
                      result="minor_revision", feedback_file="fb.pdf"))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "needs_revision"
    assert g["latest_evaluation"]["result"] == "minor_revision"


def test_mp_dashboard_status_accepted(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Evaluation, Submission
    ctx = _make_run_with_mp(admin_client, db, slug="ac")
    sub = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=ctx["student"].id,
                      result="accepted", score=90))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "accepted"
    assert g["latest_evaluation"]["score"] == 90


def test_mp_dashboard_status_rejected(admin_client, db):
    from datetime import datetime, timezone
    from mathion.models import Evaluation, Submission
    ctx = _make_run_with_mp(admin_client, db, slug="rj")
    sub = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=ctx["student"].id,
                      result="rejected", feedback_file="fb.pdf"))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "rejected"
    assert g["latest_evaluation"]["result"] == "rejected"
    assert g["latest_evaluation"]["has_feedback_file"] is True


def test_mp_dashboard_auto_accepted_resubmission(admin_client, db):
    """Resubmission after minor_revision is auto-accepted: latest sub.is_resubmission=True,
    latest eval.result=accepted, evaluated_by = original revision-requester."""
    from datetime import datetime, timezone
    from mathion.models import Submission, Evaluation
    from mathion.models_auth import User
    ctx = _make_run_with_mp(admin_client, db, slug="aar")

    teacher = User(email="aar-teacher@example.com", full_name="T")
    db.add(teacher); db.commit()

    sub1 = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub1); db.flush()
    db.add(Evaluation(submission_id=sub1.id, evaluated_by=teacher.id, result="minor_revision",
                      feedback_text="fix p3", feedback_file="fb.pdf"))
    sub2 = Submission(
        mini_project_id=ctx["mp"].id, group_id=ctx["group"].id,
        submitted_by=ctx["student"].id, submitted_at=datetime.now(timezone.utc),
        file_path="x2", submission_number=2, file_size=100, is_late=False, is_resubmission=True,
    )
    db.add(sub2); db.flush()
    db.add(Evaluation(submission_id=sub2.id, evaluated_by=teacher.id, result="accepted"))
    db.commit()

    body = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects").json()
    g = body["mini_projects"][0]["groups"][0]
    assert g["status"] == "accepted"
    assert g["latest_submission"]["is_resubmission"] is True
    assert g["latest_submission"]["submission_number"] == 2
    assert g["latest_evaluation"]["result"] == "accepted"
    assert g["latest_evaluation"]["evaluated_by"]["user_id"] == teacher.id
    assert g["latest_evaluation"]["feedback_text"] is None


def test_mp_dashboard_counts_aggregation(admin_client, db):
    """3 groups, mix of statuses: counts should sum correctly."""
    from datetime import datetime, timezone, timedelta
    from mathion.models import (Block, Sequence, Item, Group, RunStudent,
                                  MiniProject, Submission, Evaluation)
    from mathion.models_auth import User

    course = admin_client.post("/api/courses", json={"slug": "ct", "name": "CT", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, db, course["id"], groups_enabled=True)

    groups = []
    for i in range(3):
        g = Group(run_id=run["id"], name=f"G{i}")
        db.add(g); db.flush()
        s = User(email=f"ct{i}@example.com", full_name=f"S{i}")
        db.add(s); db.flush()
        db.add(RunStudent(run_id=run["id"], user_id=s.id, group_id=g.id))
        groups.append((g, s))
    mp = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=datetime.now(timezone.utc) + timedelta(days=7),
        hard_deadline=datetime.now(timezone.utc) + timedelta(days=14),
        resubmission_deadline=datetime.now(timezone.utc) + timedelta(days=21),
        is_published=True,
    )
    db.add(mp); db.commit()

    # Group 0: not_submitted (no submission)
    # Group 1: awaiting_eval (submitted, no eval)
    g1, s1 = groups[1]
    db.add(Submission(
        mini_project_id=mp.id, group_id=g1.id, submitted_by=s1.id,
        submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    ))
    # Group 2: accepted
    g2, s2 = groups[2]
    sub = Submission(
        mini_project_id=mp.id, group_id=g2.id, submitted_by=s2.id,
        submitted_at=datetime.now(timezone.utc),
        file_path="x", submission_number=1, file_size=100, is_late=False, is_resubmission=False,
    )
    db.add(sub); db.flush()
    db.add(Evaluation(submission_id=sub.id, evaluated_by=s2.id, result="accepted"))
    db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    counts = body["mini_projects"][0]["counts"]
    assert counts["total_groups"] == 3
    assert counts["not_submitted"] == 1
    assert counts["awaiting_eval"] == 1
    assert counts["accepted"] == 1
    assert counts["needs_revision"] == 0
    assert counts["rejected"] == 0


def test_mp_dashboard_groups_disabled_run_returns_empty(admin_client, db, seed_publishable_version):
    """groups_enabled=false → no MPs (per Phase 7b extension)."""
    course, version = seed_publishable_version(slug="ge", name="GE")
    run = _publish_run(admin_client, db, course["id"], groups_enabled=False)

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    assert body["mini_projects"] == []


def test_mp_dashboard_unpublished_mp_included(admin_client, db):
    """Unpublished MPs appear with is_published=false."""
    from datetime import datetime, timezone, timedelta
    from mathion.models import (Block, Sequence, Item, Group, MiniProject)
    course = admin_client.post("/api/courses", json={"slug": "up2", "name": "UP", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, db, course["id"], groups_enabled=True)
    g = Group(run_id=run["id"], name="G1")
    db.add(g); db.commit()
    mp = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=datetime.now(timezone.utc) + timedelta(days=7),
        hard_deadline=datetime.now(timezone.utc) + timedelta(days=14),
        resubmission_deadline=datetime.now(timezone.utc) + timedelta(days=21),
        is_published=False,
    )
    db.add(mp); db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    assert body["mini_projects"][0]["is_published"] is False


def test_mp_dashboard_disabled_group_visible(admin_client, db):
    """Disabled groups appear with group_is_disabled=true."""
    from datetime import datetime, timezone, timedelta
    from mathion.models import (Block, Sequence, Item, Group, MiniProject)

    course = admin_client.post("/api/courses", json={"slug": "dgmp", "name": "D", "description": ""}).json()
    version = admin_client.post(f"/api/courses/{course['id']}/versions", json={"info_md": ""}).json()
    block = Block(version_id=version["id"], title="B", slug="b", order=1)
    db.add(block); db.flush()
    seq = Sequence(block_id=block.id, title="S", slug="s", order=1)
    db.add(seq); db.flush()
    db.add(Item(sequence_id=seq.id, title="I", slug="i", order=1, type="static_page",
                content_md="x", content_html="x"))
    db.commit()
    admin_client.post(f"/api/versions/{version['id']}/publish")
    run = _publish_run(admin_client, db, course["id"], groups_enabled=True)
    g = Group(run_id=run["id"], name="G1", is_disabled=True)
    db.add(g); db.commit()
    db.add(MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="x",
        soft_deadline=datetime.now(timezone.utc) + timedelta(days=7),
        hard_deadline=datetime.now(timezone.utc) + timedelta(days=14),
        resubmission_deadline=datetime.now(timezone.utc) + timedelta(days=21),
        is_published=True,
    )); db.commit()

    body = admin_client.get(f"/api/runs/{run['id']}/dashboard/mini-projects").json()
    g_entry = body["mini_projects"][0]["groups"][0]
    assert g_entry["group_is_disabled"] is True


def test_mini_projects_dashboard_includes_mp_title(admin_client, db):
    """The dashboard response includes the per-MP title (spec §5.2 additive change)."""
    ctx = _make_run_with_mp(admin_client, db, slug="title")

    response = admin_client.get(f"/api/runs/{ctx['run']['id']}/dashboard/mini-projects")
    assert response.status_code == 200
    body = response.json()
    assert "mini_projects" in body
    assert len(body["mini_projects"]) >= 1

    first_mp = body["mini_projects"][0]
    assert "title" in first_mp, "MP rows must include `title` per spec §5.2"
    assert first_mp["title"] == f"Mini project for Block {ctx['block'].order}"
