import io
from sqlalchemy import select


def _make_submitted(admin_client, student_client_for, db, seed_run_with_groups):
    """Create published mp, submit a PDF as alice. Returns (run, ga, mp, sub)."""
    from mathion.models import Block, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={
            "block_id": block.id,
            "assignment_md": "x",
            "hard_deadline": "2026-06-01T23:59:00Z",
            "resubmission_deadline": "2026-06-15T23:59:00Z",
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    sub = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    ).json()
    return run, ga, mp, sub


def test_evaluate_accepted(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "accepted", "score": "95", "feedback_text": "Great job"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["result"] == "accepted"
    assert body["score"] == 95
    assert body["has_feedback_file"] is False


def test_evaluate_revision_requires_feedback_file(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix x"},
    )
    assert response.status_code == 422


def test_evaluate_already_evaluated_409(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation",
                      data={"result": "accepted"})
    response = admin_client.post(f"/api/submissions/{sub['id']}/evaluation",
                                 data={"result": "rejected"},
                                 files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    assert response.status_code == 409


def test_has_feedback_file_reflects_state(admin_client, student_client_for, db, seed_run_with_groups):
    """Response field has_feedback_file must be True when feedback was uploaded."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    response = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix x"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-feedback"), "application/pdf")},
    )
    assert response.status_code == 201
    assert response.json()["has_feedback_file"] is True
    # And the GET endpoint also reflects it
    response = admin_client.get(f"/api/submissions/{sub['id']}/evaluation")
    assert response.status_code == 200
    assert response.json()["has_feedback_file"] is True


def test_get_evaluation_as_group_member(admin_client, student_client_for, db, seed_run_with_groups):
    """A student in the submitting group can GET the evaluation."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "accepted", "score": "90"},
    )
    alice = student_client_for("alice@example.com")
    response = alice.get(f"/api/submissions/{sub['id']}/evaluation")
    assert response.status_code == 200
    assert response.json()["result"] == "accepted"


def test_post_evaluation_requires_admin_or_teacher(auth_client, admin_client, student_client_for, db, seed_run_with_groups):
    """Plain authenticated user (not admin, not teacher) cannot create an evaluation."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    response = auth_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "accepted"},
    )
    assert response.status_code == 403


def test_post_evaluation_blocked_on_resubmission(admin_client, student_client_for, db, seed_run_with_groups):
    """Manual evaluation is blocked on auto-accepted resubmissions."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix x"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    alice = student_client_for("alice@example.com")
    resub = alice.post(
        f"/api/mini-projects/{sub['mini_project_id']}/submissions",
        files={"file": ("r2.pdf", io.BytesIO(b"%PDF-revision"), "application/pdf")},
    ).json()
    response = admin_client.post(
        f"/api/submissions/{resub['id']}/evaluation",
        data={"result": "accepted"},
    )
    assert response.status_code == 409
