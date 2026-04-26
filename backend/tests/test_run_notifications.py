from mathion.models_auth import NotificationLogEntry


def test_full_run_lifecycle_writes_three_notification_kinds(admin_client, db, seed_publishable_version):
    course, _ = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01"},
    ).json()

    # 1. run_teacher_assigned
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teacher@example.com"})

    # 2. run_enrolled
    admin_client.post(f"/api/runs/{run['id']}/students", json={"email": "alice@example.com"})

    # 3. run_published (one row per student)
    admin_client.post(f"/api/runs/{run['id']}/publish")

    rows = db.query(NotificationLogEntry).all()
    by_kind = {}
    for r in rows:
        by_kind.setdefault(r.kind, []).append(r)

    assert "run_teacher_assigned" in by_kind
    assert "run_enrolled" in by_kind
    assert "run_published" in by_kind

    for r in rows:
        assert "run_id" in r.payload
        assert r.sent_at is None  # phase 9 hasn't run
