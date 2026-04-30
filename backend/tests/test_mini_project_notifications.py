import io
from sqlalchemy import select


def _setup(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models import Block, Run
    run, ga, _ = seed_run_with_groups()
    run_obj = db.get(Run, run["id"])
    block = db.execute(select(Block).where(Block.version_id == run_obj.version_id)).scalars().first()
    mp = admin_client.post(
        f"/api/runs/{run['id']}/mini-projects",
        json={"block_id": block.id, "assignment_md": "x",
              "hard_deadline": "2026-06-01T23:59:00Z",
              "resubmission_deadline": "2026-06-15T23:59:00Z"},
    ).json()
    admin_client.post(f"/api/mini-projects/{mp['id']}/publish")
    student = student_client_for("alice@example.com")
    sub = student.post(f"/api/mini-projects/{mp['id']}/submissions",
                       files={"file": ("r.pdf", io.BytesIO(b"%PDF"), "application/pdf")}).json()
    return run, ga, mp, sub


def test_evaluation_received_on_manual_eval(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models_auth import NotificationLogEntry
    _, _, _, sub = _setup(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(f"/api/submissions/{sub['id']}/evaluation", data={"result": "accepted"})
    rows = db.query(NotificationLogEntry).filter_by(kind="evaluation_received").all()
    assert len(rows) == 1
    assert rows[0].payload["result"] == "accepted"


def test_evaluation_received_on_auto_accept(admin_client, student_client_for, db, seed_run_with_groups):
    from mathion.models_auth import NotificationLogEntry
    _, _, mp, sub = _setup(admin_client, student_client_for, db, seed_run_with_groups)
    admin_client.post(
        f"/api/submissions/{sub['id']}/evaluation",
        data={"result": "minor_revision", "feedback_text": "fix"},
        files={"file": ("fb.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
    )
    student = student_client_for("alice@example.com")
    student.post(f"/api/mini-projects/{mp['id']}/submissions",
                 files={"file": ("r2.pdf", io.BytesIO(b"%PDF"), "application/pdf")})
    rows = db.query(NotificationLogEntry).filter_by(kind="evaluation_received").all()
    # One for manual eval (minor_revision) + one for auto-accept = 2
    assert len(rows) == 2
    assert {r.payload["result"] for r in rows} == {"minor_revision", "accepted"}
