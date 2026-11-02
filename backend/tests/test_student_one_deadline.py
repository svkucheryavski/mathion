"""D81 (user): a student sees ONE deadline per mini-project -- the soft one, or
the hard one when no soft one is set; in a revision, the resubmission one. The
hard deadline is a hidden grace window ("they should not know the submission
will be accepted between soft and hard, otherwise nobody will respect soft
deadlines"), so the student API never sends it: it sends `deadline`,
`deadline_kind` and `deadline_open` instead. A resubmission is never late.
The run-level mini-project endpoints, which carry all three dates, are for the
run's admins and teachers only."""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from alembic import command
from alembic.config import Config

from mathion.api.student_mini_projects import _student_deadline
from mathion.models import Course, CourseVersion, MiniProject, Run, RunTeacher, Submission

NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)


def _d(days: float) -> datetime:
    return NOW + timedelta(days=days)


def _mp(hard=None, soft=None, resub=None):
    return SimpleNamespace(hard_deadline=hard, soft_deadline=soft, resubmission_deadline=resub)


# --- the rule ---------------------------------------------------------------

def test_soft_is_the_deadline_open_until_the_hidden_hard_one():
    assert _student_deadline(_mp(hard=_d(10), soft=_d(5)), "not_submitted", NOW) == (_d(5), "due", True)
    assert _student_deadline(_mp(hard=_d(10), soft=_d(-1)), "not_submitted", NOW) == (_d(-1), "due", True)
    assert _student_deadline(_mp(hard=_d(-1), soft=_d(-2)), "rejected", NOW) == (_d(-2), "due", False)


def test_hard_is_the_deadline_only_with_no_soft_one():
    assert _student_deadline(_mp(hard=_d(10)), "pending_group_assignment", NOW) == (_d(10), "due", True)
    assert _student_deadline(_mp(hard=_d(-1)), "not_submitted", NOW) == (_d(-1), "due", False)


def test_soft_with_no_hard_never_closes():
    assert _student_deadline(_mp(soft=_d(-3)), "not_submitted", NOW) == (_d(-3), "due", True)


def test_revision_uses_the_resubmission_deadline_none_means_no_deadline():
    assert _student_deadline(_mp(hard=_d(-2), soft=_d(-3), resub=_d(4)), "major_revision", NOW) == (_d(4), "resubmit", True)
    assert _student_deadline(_mp(resub=_d(-1)), "minor_revision", NOW) == (_d(-1), "resubmit", False)
    assert _student_deadline(_mp(hard=_d(5), soft=_d(4)), "minor_revision", NOW) == (None, None, True)


def test_accepted_work_has_no_deadline():
    # User (D81 review r1): nothing is due once the work is accepted.
    assert _student_deadline(_mp(hard=_d(-1), soft=_d(-2), resub=_d(5)), "accepted", NOW) == (None, None, True)


def test_no_date_at_all_means_no_deadline_and_open():
    assert _student_deadline(_mp(), "not_submitted", NOW) == (None, None, True)


def test_a_window_closing_at_this_very_moment_is_still_open():
    # The submit gate refuses only strictly after the deadline.
    assert _student_deadline(_mp(hard=NOW, soft=_d(-1)), "not_submitted", NOW)[2] is True
    assert _student_deadline(_mp(resub=NOW), "major_revision", NOW)[2] is True


def test_naive_database_datetimes_compare_as_utc():
    naive_hard = _d(-1).replace(tzinfo=None)
    assert _student_deadline(_mp(hard=naive_hard), "not_submitted", NOW)[2] is False


# --- the student responses ---------------------------------------------------

HIDDEN_KEYS = {"hard_deadline", "soft_deadline", "resubmission_deadline"}


def _course_slug(db, run_id: int) -> str:
    run = db.get(Run, run_id)
    return db.get(Course, db.get(CourseVersion, run.version_id).course_id).slug


def _set_dates(db, mp_id: int, **dates):
    mp = db.get(MiniProject, mp_id)
    for k, v in dates.items():
        setattr(mp, k, v)
    db.commit()


def _iso_forms(dt: datetime) -> list[str]:
    # Every way the hard date could appear in a JSON body.
    return [dt.isoformat(), dt.replace(tzinfo=None).isoformat(), dt.strftime("%Y-%m-%dT%H:%M")]


def test_list_sends_one_deadline_and_never_the_hard_one(student_client_for, db, seed_run_with_published_mp):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    soft, hard = now + timedelta(days=3), now + timedelta(days=9)
    _set_dates(db, mp["id"], soft_deadline=soft, hard_deadline=hard)
    sc = student_client_for("alice@example.com")
    resp = sc.get(f"/api/courses/{_course_slug(db, run['id'])}/mini-projects")
    assert resp.status_code == 200, resp.text
    item = resp.json()[0]
    assert HIDDEN_KEYS.isdisjoint(item)
    assert item["deadline_kind"] == "due"
    assert datetime.fromisoformat(item["deadline"].replace("Z", "+00:00")) == soft
    assert item["deadline_open"] is True
    for s in _iso_forms(hard):
        assert s not in resp.text


def test_detail_sends_one_deadline_and_never_the_hard_one(student_client_for, db, seed_run_with_published_mp):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    soft, hard = now - timedelta(days=1), now + timedelta(days=6)
    _set_dates(db, mp["id"], soft_deadline=soft, hard_deadline=hard)
    sc = student_client_for("alice@example.com")
    resp = sc.get(f"/api/courses/{_course_slug(db, run['id'])}/blocks/b/mini-project")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert HIDDEN_KEYS.isdisjoint(body)
    assert (body["deadline_kind"], body["deadline_open"], body["can_submit"]) == ("due", True, True)
    assert datetime.fromisoformat(body["deadline"].replace("Z", "+00:00")) == soft
    for s in _iso_forms(hard):
        assert s not in resp.text
    assert "hard" not in json.dumps(body).lower()


def test_detail_in_a_revision_sends_the_resubmission_deadline(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    sc = student_client_for("alice@example.com")
    sub = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    resub = db.get(MiniProject, mp["id"]).resubmission_deadline
    body = sc.get(f"/api/courses/{_course_slug(db, run['id'])}/blocks/b/mini-project").json()
    assert body["deadline_kind"] == "resubmit"
    assert datetime.fromisoformat(body["deadline"].replace("Z", "+00:00")) == resub.replace(tzinfo=resub.tzinfo or timezone.utc)
    assert body["deadline_open"] is True


def test_accepted_after_a_resubmission_sends_no_deadline(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    # A resubmission is accepted when it is sent (submissions.py auto-evaluation).
    run, _ga, _gb, mp = seed_run_with_published_mp()
    sc = student_client_for("alice@example.com")
    first = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("a.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{first['id']}/evaluation",
        data={"result": "major_revision", "feedback_text": "Redo"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("b.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    slug = _course_slug(db, run["id"])
    body = sc.get(f"/api/courses/{slug}/blocks/b/mini-project").json()
    item = sc.get(f"/api/courses/{slug}/mini-projects").json()[0]
    for b in (body, item):
        assert b["latest_status"] == "accepted"
        assert (b["deadline"], b["deadline_kind"]) == (None, None)


def test_detail_reason_names_no_hard_deadline(student_client_for, db, seed_run_with_published_mp):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    now = datetime.now(timezone.utc)
    _set_dates(db, mp["id"], soft_deadline=now - timedelta(days=2), hard_deadline=now - timedelta(days=1))
    sc = student_client_for("alice@example.com")
    body = sc.get(f"/api/courses/{_course_slug(db, run['id'])}/blocks/b/mini-project").json()
    assert body["can_submit"] is False
    assert body["can_submit_reason_if_not"] == "deadline_passed"
    assert body["deadline_open"] is False


# --- late ----------------------------------------------------------------------

def test_a_resubmission_is_never_late_a_first_submission_after_soft_is(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    now = datetime.now(timezone.utc)
    _set_dates(db, mp["id"], soft_deadline=now - timedelta(days=1))
    sc = student_client_for("alice@example.com")
    first = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("a.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert first.status_code == 201, first.text
    assert first.json()["is_late"] is True
    admin_client.post(
        f"/api/submissions/{first.json()['id']}/evaluation",
        data={"result": "major_revision", "feedback_text": "Redo"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    second = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("b.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert second.status_code == 201, second.text
    assert second.json()["is_resubmission"] is True
    assert second.json()["is_late"] is False
    assert db.get(Submission, second.json()["id"]).is_late is False


def _cfg() -> Config:
    return Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))


def test_migration_clears_the_late_mark_on_existing_resubmissions(
    admin_client, student_client_for, db, seed_run_with_published_mp,
):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    sc = student_client_for("alice@example.com")
    first = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("a.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()
    admin_client.post(
        f"/api/submissions/{first['id']}/evaluation",
        data={"result": "major_revision", "feedback_text": "Redo"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    second = sc.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("b.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()
    # Rows as the old rule stored them: late against the soft deadline.
    for sid in (first["id"], second["id"]):
        db.get(Submission, sid).is_late = True
    db.commit()
    ids = (first["id"], second["id"])
    db.close()

    command.downgrade(_cfg(), "b3c1d9e5a7f2")
    command.upgrade(_cfg(), "head")

    late = {s.id: s.is_late for s in db.query(Submission).filter(Submission.id.in_(ids))}
    assert late == {ids[0]: True, ids[1]: False}


# --- run-level endpoints: teachers and admins only ---------------------------

def test_run_mini_project_endpoints_refuse_a_student(student_client_for, db, seed_run_with_published_mp):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    sc = student_client_for("alice@example.com")
    assert sc.get(f"/api/runs/{run['id']}/mini-projects").status_code == 403
    assert sc.get(f"/api/mini-projects/{mp['id']}").status_code == 403


def test_run_mini_project_endpoints_refuse_a_stranger(auth_client, seed_run_with_published_mp):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    assert auth_client.get(f"/api/runs/{run['id']}/mini-projects").status_code == 403
    assert auth_client.get(f"/api/mini-projects/{mp['id']}").status_code == 403


def test_run_mini_project_endpoints_serve_the_run_teacher(
    teacher_client, teacher_user, db, seed_run_with_published_mp,
):
    run, _ga, _gb, mp = seed_run_with_published_mp()
    if db.query(RunTeacher).filter_by(run_id=run["id"], user_id=teacher_user.id).first() is None:
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
    listed = teacher_client.get(f"/api/runs/{run['id']}/mini-projects")
    assert listed.status_code == 200, listed.text
    assert listed.json()[0]["hard_deadline"] is not None
    one = teacher_client.get(f"/api/mini-projects/{mp['id']}")
    assert one.status_code == 200, one.text
    assert one.json()["hard_deadline"] is not None
