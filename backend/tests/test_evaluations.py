import io
from sqlalchemy import select

from tests.conftest import NEAR_DEADLINE_ISO, FAR_DEADLINE_ISO, _assert_hidden


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
            "hard_deadline": NEAR_DEADLINE_ISO,
            "resubmission_deadline": FAR_DEADLINE_ISO,
        },
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    sub = student.post(
        f"/api/mini-projects/{mp['id']}/submissions",
        files={"file": ("r.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
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
                                 files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")})
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
    """Non-staff cannot create an evaluation, and existence is hidden (404, not 403)."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    missing = auth_client.post("/api/submissions/999999/evaluation", data={"result": "accepted"})
    forbidden = auth_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    _assert_hidden(forbidden, missing)


def test_patch_evaluation_hides_existence(auth_client, admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    ev = admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"}).json()
    missing = auth_client.patch("/api/evaluations/999999", json={})
    forbidden = auth_client.patch(f"/api/evaluations/{ev['id']}", json={})
    _assert_hidden(forbidden, missing)


def test_patch_evaluation_as_admin_succeeds(admin_client, student_client_for, db, seed_run_with_groups):
    """An authorized staff PATCH returns 200 and the change persists."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    ev = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "accepted", "score": "90"},
    ).json()
    assert ev["score"] == 90  # pre-PATCH baseline, so 70 below is provably a real change
    response = admin_client.patch(f"/api/evaluations/{ev['id']}", json={"score": 70})
    assert response.status_code == 200
    assert response.json()["score"] == 70
    # The change was durably committed, not just visible in the shared test session:
    # rollback discards any uncommitted mutation before the re-GET forces a fresh read.
    db.rollback()
    reget = admin_client.get(f"/api/submissions/{sub['id']}/evaluation")
    assert reget.status_code == 200
    assert reget.json()["score"] == 70


def test_post_evaluation_blocked_on_resubmission(admin_client, student_client_for, db, seed_run_with_groups):
    """Manual evaluation is blocked on auto-accepted resubmissions."""
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "Fix x"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
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


def test_feedback_file_rejects_non_pdf_content(admin_client, student_client_for, db, seed_run_with_groups):
    _, _, _, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    resp = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "x"},
        files={"file": ("fb.pdf", io.BytesIO(b"MZ\x90\x00not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "feedback_file is not a valid PDF (missing %PDF- header)"


def test_get_evaluation_hides_existence(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Run
    run, ga, mp, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    bob = student_client_for("bob@example.com")
    missing = bob.get("/api/submissions/999999/evaluation")
    membership = bob.get(f"/api/submissions/{sub['id']}/evaluation")
    run_obj = db.get(Run, run["id"]); run_obj.is_published = False; db.commit()
    alice = student_client_for("alice@example.com")
    visibility = alice.get(f"/api/submissions/{sub['id']}/evaluation")
    _assert_hidden(membership, missing)
    _assert_hidden(visibility, missing)


def test_get_feedback_file_hides_existence(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Run
    run, ga, mp, sub = _make_submitted(admin_client, student_client_for, db, seed_run_with_groups)
    ev = admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "x"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    ).json()
    bob = student_client_for("bob@example.com")
    missing = bob.get("/api/evaluations/999999/feedback-file")
    membership = bob.get(f"/api/evaluations/{ev['id']}/feedback-file")
    run_obj = db.get(Run, run["id"]); run_obj.is_published = False; db.commit()
    alice = student_client_for("alice@example.com")
    visibility = alice.get(f"/api/evaluations/{ev['id']}/feedback-file")
    _assert_hidden(membership, missing)
    _assert_hidden(visibility, missing)
