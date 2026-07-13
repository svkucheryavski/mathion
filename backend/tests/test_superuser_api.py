from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from mathion.models_auth import Session as UserSession, User
from mathion.superuser import service as panel_service


def _seed_storage(db, *, asset=None, run_asset=None, submission=None):
    """Build a Course->Version->Block+Run->Group->MiniProject chain and add
    Asset / RunAsset / Submission rows only for the sizes passed (each may be None)."""
    from mathion.models import (
        Asset, Block, Course, CourseVersion, Group, MiniProject, Run, RunAsset, Submission,
    )

    course = Course(slug="stg", name="Storage")
    db.add(course)
    db.flush()
    version = CourseVersion(course_id=course.id)
    db.add(version)
    db.flush()
    block = Block(version_id=version.id, title="B", slug="b", order=1)
    run = Run(version_id=version.id, title="R", start_date=date(2026, 1, 1), end_date=date(2026, 6, 1))
    db.add_all([block, run])
    db.flush()
    group = Group(run_id=run.id, name="G1")
    student = User(email="stg-student@example.com")
    db.add_all([group, student])
    db.flush()
    mp = MiniProject(run_id=run.id, block_id=block.id, assignment_md="x", assignment_html="x")
    db.add(mp)
    db.flush()

    if asset is not None:
        db.add(Asset(version_id=version.id, filename="a.bin", file_size=asset, mime_type="text/plain"))
    if run_asset is not None:
        db.add(RunAsset(run_id=run.id, filename="r.bin", file_size=run_asset, mime_type="text/plain"))
    if submission is not None:
        db.add(Submission(
            mini_project_id=mp.id, group_id=group.id, submitted_by=student.id,
            file_path="x", submission_number=1, file_size=submission,
        ))
    db.commit()


def test_two_factor_matrix(admin_client, auth_client, client, db):
    token = panel_service.mint(db)
    # valid token + superuser session -> 200
    assert admin_client.get(f"/api/superuser/{token}/stats").status_code == 200
    # valid token + no session -> 401
    assert client.get(f"/api/superuser/{token}/stats").status_code == 401
    # valid token + non-superuser session -> 404 (NOT 403)
    assert auth_client.get(f"/api/superuser/{token}/stats").status_code == 404
    # bad token + superuser session -> 404
    assert admin_client.get("/api/superuser/bogus/stats").status_code == 404


def test_counts(admin_client, db):
    from mathion.models import Course

    for i in range(3):
        db.add(User(email=f"u{i}@example.com"))
    for i in range(2):
        db.add(Course(slug=f"c{i}", name=f"C{i}"))
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    # +1 user: admin_client's superuser fixture (admin@example.com).
    assert data["total_users"] == 4
    assert data["total_courses"] == 2


def test_storage_sums_three_registries(admin_client, db):
    _seed_storage(db, asset=100, run_asset=20, submission=3)
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["storage_bytes"] == 123


def test_submission_only_storage_is_nonzero(admin_client, db):
    _seed_storage(db, submission=7)
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["storage_bytes"] == 7


def test_empty_db_storage_is_zero(admin_client, db):
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["storage_bytes"] == 0


def test_active_windows_and_distinct(admin_client, db):
    now = datetime.now(timezone.utc)
    u1, u2, u3 = User(email="w1@example.com"), User(email="w2@example.com"), User(email="w3@example.com")
    db.add_all([u1, u2, u3])
    db.flush()
    exp = now + timedelta(days=7)
    db.add_all([
        UserSession(user_id=u1.id, token_hash="h1", expires_at=exp,
                    last_active_at=now - timedelta(hours=24) + timedelta(seconds=1)),  # inside 24h
        UserSession(user_id=u1.id, token_hash="h1b", expires_at=exp,
                    last_active_at=now - timedelta(minutes=1)),                          # dup for u1
        UserSession(user_id=u2.id, token_hash="h2", expires_at=exp,
                    last_active_at=now - timedelta(hours=25)),                           # outside 24h, inside 7d
        UserSession(user_id=u3.id, token_hash="h3", expires_at=exp,
                    last_active_at=now - timedelta(days=8)),                             # outside 7d
    ])
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    # admin_client's own session (~now) contributes one active user in both windows.
    assert data["active_users_24h"] == 2   # {u1 (deduped), admin}
    assert data["active_users_7d"] == 3    # {u1, u2, admin}


def test_expired_but_recently_active_session_counts(admin_client, db):
    now = datetime.now(timezone.utc)
    u = User(email="exp@example.com")
    db.add(u)
    db.flush()
    db.add(UserSession(user_id=u.id, token_hash="hx",
                       expires_at=now - timedelta(days=1),          # already expired
                       last_active_at=now - timedelta(hours=1)))    # but active in 24h
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["active_users_24h"] == 2   # admin + u


def test_disabled_user_session_not_excluded(admin_client, db):
    now = datetime.now(timezone.utc)
    u = User(email="dis@example.com", is_disabled=True)
    db.add(u)
    db.flush()
    db.add(UserSession(user_id=u.id, token_hash="hd", expires_at=now + timedelta(days=7),
                       last_active_at=now - timedelta(hours=1)))
    db.commit()
    token = panel_service.mint(db)
    data = admin_client.get(f"/api/superuser/{token}/stats").json()
    assert data["active_users_24h"] == 2   # admin + disabled u


def test_stats_sets_no_store_and_no_referrer_headers(admin_client, db):
    token = panel_service.mint(db)
    resp = admin_client.get(f"/api/superuser/{token}/stats")
    assert resp.headers["Cache-Control"] == "no-store"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
