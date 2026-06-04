import io
from sqlalchemy import select

from tests.conftest import NEAR_DEADLINE_ISO, FAR_DEADLINE_ISO


def _make_published_mp(admin_client, db, seed_run_with_groups):
    from mathion.models import Block, Run
    run, ga, gb = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "Report.",
            "hard_deadline": NEAR_DEADLINE_ISO,
            "resubmission_deadline": FAR_DEADLINE_ISO,
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    return run, ga, gb, mp


def test_initial_submission(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("report.pdf", io.BytesIO(b"%PDF-1.4 stuff"), "application/pdf")},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["submission_number"] == 1
    assert body["is_late"] is False
    assert body["is_resubmission"] is False
    assert body["group_id"] == ga["id"]


def test_submit_blocks_non_group_member(admin_client, student_client_for, db, seed_run_with_groups):
    run, _, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    # Add another user not in any group
    from mathion.models_auth import User
    db.add(User(email="outsider@example.com", full_name="O"))
    db.commit()
    outsider = student_client_for("outsider@example.com")
    response = outsider.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 403


def test_submit_enrolled_but_no_group(admin_client, student_client_for, db, seed_run_with_groups):
    """Enrolled student with no group assignment cannot submit."""
    run, _, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    from mathion.models import RunStudent
    from mathion.models_auth import User
    user = User(email="lonely@example.com", full_name="L")
    db.add(user); db.commit()
    db.add(RunStudent(run_id=run["id"], user_id=user.id, group_id=None))
    db.commit()
    lonely = student_client_for("lonely@example.com")
    response = lonely.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 403


def test_submit_blocked_after_hard_deadline(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Block, MiniProject, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    # Create with past hard_deadline directly via DB (bypasses publish-gate which would reject)
    from datetime import datetime, timezone
    mp_obj = MiniProject(
        run_id=run["id"], block_id=block.id,
        assignment_md="x", assignment_html="<p>x</p>",
        hard_deadline=datetime(2020, 1, 1, tzinfo=timezone.utc),
        resubmission_deadline=datetime(2020, 1, 15, tzinfo=timezone.utc),
        is_published=True,
    )
    db.add(mp_obj)
    db.commit()
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{mp_obj.id}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_submit_to_disabled_group(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    # Disable group A
    admin_client.patch(f"/api/groups/{ga['id']}", json={"is_disabled": True})
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_pending_evaluation_blocks_resubmit(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_first_submitted_at_set(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import MiniProject
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    db.expire_all()
    mp_obj = db.get(MiniProject, mp["id"])
    assert mp_obj.first_submitted_at is not None


def test_lock_blocks_assignment_md_edit(admin_client, student_client_for, db, seed_run_with_groups):
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    response = admin_client.patch(f"/api/mini-projects/{mp['id']}", json={"assignment_md": "new text"})
    assert response.status_code == 409


def _make_submitted(admin_client, student_client_for, db, seed_run_with_groups):
    """Create published mp, submit a PDF as alice. Returns (run, ga, mp, sub)."""
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    sub = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    return run, ga, mp, sub


def test_resubmission_auto_accepts(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    # Teacher requests minor revision
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    # Group member resubmits
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 201
    new_sub = response.json()
    assert new_sub["is_resubmission"] is True
    # Auto-evaluation should exist
    from mathion.models import Evaluation
    ev = db.execute(select(Evaluation).where(Evaluation.submission_id == new_sub["id"])).scalar_one()
    assert ev.result == "accepted"


def test_rejected_resets_to_initial(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "rejected", "feedback_text": "wrong file"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 201
    assert response.json()["is_resubmission"] is False  # fresh initial


def test_accepted_blocks_resubmit(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    assert response.status_code == 409


def test_submit_disallowed_extension(admin_client, student_client_for, db, seed_run_with_groups):
    """Uploading a file with a disallowed extension returns a clear error
    (distinct from the 'must be a PDF' message used for allowed-but-wrong types)."""
    run, ga, _, mp = _make_published_mp(admin_client, db, seed_run_with_groups)
    student = student_client_for("alice@example.com")
    response = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("malware.exe", io.BytesIO(b"MZ\x90\x00"), "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "File extension not allowed" in response.json()["detail"]
