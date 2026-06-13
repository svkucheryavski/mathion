"""Tests for the teacher monitoring surface (Slice A).

Helper unit tests are called as plain Python functions (not via HTTP),
matching the precedent at `backend/tests/test_run_permissions.py` and
`backend/tests/test_slugify.py`.
"""
from datetime import date

from sqlalchemy.orm import Session

from mathion.api.helpers import (
    has_run_teacher_on_course,
    has_run_pinned_to_version,
)
from mathion.models import Course, CourseAdmin, CourseVersion, Run, RunTeacher
from mathion.models_auth import User


def _make_user(db: Session, email: str) -> User:
    u = User(email=email, full_name=email.split("@")[0])
    db.add(u); db.commit(); db.refresh(u); return u


def _make_course(db: Session, slug: str = "c1", name: str = "C1") -> Course:
    c = Course(slug=slug, name=name, description="")
    db.add(c); db.commit(); db.refresh(c); return c


def _make_version(
    db: Session, course_id: int, state: str = "published", is_disabled: bool = False
) -> CourseVersion:
    v = CourseVersion(course_id=course_id, state=state, is_disabled=is_disabled,
                      info_md="", info_html="")
    db.add(v); db.commit(); db.refresh(v); return v


def _make_run(db: Session, version_id: int, title: str = "R") -> Run:
    r = Run(version_id=version_id, title=title,
            start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            groups_enabled=False, is_published=False)
    db.add(r); db.commit(); db.refresh(r); return r


def _link_teacher(db: Session, run_id: int, user_id: int) -> None:
    db.add(RunTeacher(run_id=run_id, user_id=user_id)); db.commit()


class TestHasRunTeacherOnCourse:
    def test_hits_when_teacher_row_on_pinned_version(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v = _make_version(db, c.id)
        r = _make_run(db, v.id)
        _link_teacher(db, r.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True

    def test_hits_when_teacher_row_on_different_version_of_same_course(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v1 = _make_version(db, c.id)
        v2 = _make_version(db, c.id)
        r2 = _make_run(db, v2.id)
        _link_teacher(db, r2.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True
        assert v1.id != v2.id  # sanity

    def test_hits_when_teacher_row_on_draft_state_version(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v = _make_version(db, c.id, state="created")
        r = _make_run(db, v.id)
        _link_teacher(db, r.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True

    def test_hits_when_multiple_teacher_rows_on_same_course(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v = _make_version(db, c.id)
        r1 = _make_run(db, v.id, "R1")
        r2 = _make_run(db, v.id, "R2")
        _link_teacher(db, r1.id, u.id)
        _link_teacher(db, r2.id, u.id)
        assert has_run_teacher_on_course(db, u, c.id) is True

    def test_misses_when_no_teacher_row(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        _make_version(db, c.id)
        assert has_run_teacher_on_course(db, u, c.id) is False

    def test_misses_when_teacher_row_on_different_course(self, db):
        u = _make_user(db, "t@x")
        c1 = _make_course(db, "c1", "C1")
        c2 = _make_course(db, "c2", "C2")
        v2 = _make_version(db, c2.id)
        r2 = _make_run(db, v2.id)
        _link_teacher(db, r2.id, u.id)
        assert has_run_teacher_on_course(db, u, c1.id) is False

    def test_misses_when_only_other_user_has_teacher_row(self, db):
        u = _make_user(db, "t@x")
        other = _make_user(db, "o@x")
        c = _make_course(db)
        v = _make_version(db, c.id)
        r = _make_run(db, v.id)
        _link_teacher(db, r.id, other.id)
        assert has_run_teacher_on_course(db, u, c.id) is False


class TestHasRunPinnedToVersion:
    def test_hits_when_teacher_row_on_run_with_this_version_id(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db); v = _make_version(db, c.id)
        r = _make_run(db, v.id); _link_teacher(db, r.id, u.id)
        assert has_run_pinned_to_version(db, u, v.id) is True

    def test_misses_when_teacher_row_on_run_with_different_version_id(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db)
        v1 = _make_version(db, c.id); v2 = _make_version(db, c.id)
        r1 = _make_run(db, v1.id); _link_teacher(db, r1.id, u.id)
        assert has_run_pinned_to_version(db, u, v2.id) is False

    def test_misses_when_no_teacher_row(self, db):
        u = _make_user(db, "t@x")
        c = _make_course(db); v = _make_version(db, c.id)
        _make_run(db, v.id)
        assert has_run_pinned_to_version(db, u, v.id) is False

    def test_misses_when_only_other_user_has_teacher_row(self, db):
        u = _make_user(db, "t@x"); other = _make_user(db, "o@x")
        c = _make_course(db); v = _make_version(db, c.id)
        r = _make_run(db, v.id); _link_teacher(db, r.id, other.id)
        assert has_run_pinned_to_version(db, u, v.id) is False

    def test_hits_when_pinned_version_is_created_state(self, db):
        u = _make_user(db, "t@x"); c = _make_course(db)
        v = _make_version(db, c.id, state="created")
        r = _make_run(db, v.id); _link_teacher(db, r.id, u.id)
        assert has_run_pinned_to_version(db, u, v.id) is True

    def test_hits_when_pinned_version_is_disabled(self, db):
        u = _make_user(db, "t@x"); c = _make_course(db)
        v = _make_version(db, c.id, is_disabled=True)
        r = _make_run(db, v.id); _link_teacher(db, r.id, u.id)
        assert has_run_pinned_to_version(db, u, v.id) is True


# ============================================================================
# T2: backend gate widening — endpoint tests + cascade-guard tests
# ============================================================================


class TestBySlugTeacherAccess:
    def test_by_slug_allows_run_teacher_returns_is_admin_false(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200, r.text
        assert r.json()["is_admin"] is False

    def test_by_slug_superuser_who_is_also_teacher_returns_is_admin_true(
        self, admin_client, superuser, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=superuser.id))
        db.commit()
        r = admin_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200
        assert r.json()["is_admin"] is True  # superuser precedence

    def test_by_slug_course_admin_who_is_also_teacher_returns_is_admin_true(
        self, admin_client, student_client_for, seed_publishable_version, db,
    ):
        # Non-superuser User who is BOTH CourseAdmin and RunTeacher must get
        # is_admin=True via the CourseAdmin precedence branch (spec §3.1.1
        # gate order: superuser → CourseAdmin → RunTeacher → 403).
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        dual = User(email="dual@example.com", full_name="Dual")
        db.add(dual); db.commit(); db.refresh(dual)
        db.add(CourseAdmin(course_id=course["id"], user_id=dual.id))
        db.add(RunTeacher(run_id=run["id"], user_id=dual.id))
        db.commit()
        dual_client = student_client_for("dual@example.com")
        r = dual_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_by_slug_superuser_returns_is_admin_true(
        self, admin_client, seed_publishable_version,
    ):
        course, _ = seed_publishable_version()
        r = admin_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 200
        assert r.json()["is_admin"] is True

    def test_by_slug_still_rejects_non_member(
        self, teacher_client, seed_publishable_version,
    ):
        course, _ = seed_publishable_version()
        # teacher_user has no roles on this course
        r = teacher_client.get(f"/api/courses/by-slug/{course['slug']}")
        assert r.status_code == 403


class TestVersionsListTeacherAccess:
    def test_returns_only_pinned_versions_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        v3 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        # Teacher's only run is pinned to v2
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # repin run to v2 manually
        from mathion.models import Run
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v2["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200, r.text
        ids = [v["id"] for v in r.json()]
        assert ids == [v2["id"]]
        assert v1["id"] not in ids and v3["id"] not in ids

    def test_returns_multiple_pinned_versions_when_teacher_teaches_multiple_runs_on_same_course(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        r1 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R1", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        r2 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R2", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # r1 → v1, r2 → v2
        db.query(Run).filter(Run.id == r1["id"]).update({"version_id": v1["id"]})
        db.query(Run).filter(Run.id == r2["id"]).update({"version_id": v2["id"]})
        db.add(RunTeacher(run_id=r1["id"], user_id=teacher_user.id))
        db.add(RunTeacher(run_id=r2["id"], user_id=teacher_user.id))
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        ids = [v["id"] for v in r.json()]
        assert ids == sorted([v1["id"], v2["id"]])  # id ASC order

    def test_includes_pinned_draft_state_version_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        # Course with a draft version. Pin a teacher run to it.
        course, _ = seed_publishable_version()
        v_draft = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        # Don't publish v_draft; it stays in 'created' state.
        from mathion.models import Run
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v_draft["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        assert v_draft["id"] in [v["id"] for v in r.json()]

    def test_includes_pinned_disabled_version_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import CourseVersion as CV
        course, v1 = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        # Disable v1 directly
        db.query(CV).filter(CV.id == v1["id"]).update({"is_disabled": True})
        db.commit()

        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        assert v1["id"] in [v["id"] for v in r.json()]

    def test_admin_still_sees_all_versions_with_original_order_and_pagination(
        self, admin_client, seed_publishable_version,
    ):
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        v3 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        r = admin_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 200
        all_ids = [v["id"] for v in r.json()]
        # Spec §6.1: lock full created_at DESC, id DESC order — newest first.
        assert all_ids == [v3["id"], v2["id"], v1["id"]]

        # Spec §6.1: ?limit=1&offset=1 must return the middle row only.
        r2 = admin_client.get(f"/api/courses/{course['id']}/versions?limit=1&offset=1")
        assert r2.status_code == 200
        assert [v["id"] for v in r2.json()] == [v2["id"]]

    def test_versions_list_still_rejects_non_member(
        self, teacher_client, seed_publishable_version,
    ):
        course, _ = seed_publishable_version()
        r = teacher_client.get(f"/api/courses/{course['id']}/versions")
        assert r.status_code == 403


class TestBlocksListTeacherAccess:
    def test_allows_teacher_on_pinned_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get(f"/api/versions/{v['id']}/blocks")
        assert r.status_code == 200, r.text

    def test_allows_teacher_on_pinned_disabled_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import CourseVersion as CV
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.query(CV).filter(CV.id == v["id"]).update({"is_disabled": True})
        db.commit()
        r = teacher_client.get(f"/api/versions/{v['id']}/blocks")
        assert r.status_code == 200

    def test_allows_teacher_on_pinned_draft_state_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, _ = seed_publishable_version()
        v_draft = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v_draft["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get(f"/api/versions/{v_draft['id']}/blocks")
        assert r.status_code == 200

    def test_rejects_teacher_on_unpinned_published_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # pin to v1
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v1["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        # request v2 (unpinned)
        r = teacher_client.get(f"/api/versions/{v2['id']}/blocks")
        assert r.status_code == 403

    def test_blocks_list_still_rejects_non_member(
        self, teacher_client, seed_publishable_version,
    ):
        _, v = seed_publishable_version()
        r = teacher_client.get(f"/api/versions/{v['id']}/blocks")
        assert r.status_code == 403


def _upload_asset(admin_client, version_id: int, filename: str = "logo.png",
                  data: bytes = b"PNGDATA") -> dict:
    """Upload an asset as admin and return the created asset dict (with id)."""
    r = admin_client.post(
        f"/api/versions/{version_id}/assets",
        files={"file": (filename, data, "image/png")},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


def _seed_teacher_with_pinned_version_and_asset(
    db, admin_client, teacher_user, seed_publishable_version,
    *, state: str = "published", is_disabled: bool = False,
    filename: str = "logo.png",
):
    """Returns (course, version_dict, filename, asset_dict). Pins teacher to a run
    on this version and uploads an asset to the version.

    NOTE (deviation from plan): the upload must happen BEFORE we apply the
    `is_disabled` SQL update — otherwise the admin upload endpoint 403s because
    `is_disabled` short-circuits write paths. The plan's helper order would
    fail the seed (upload step 403s); this corrected order preserves the intent."""
    from mathion.models import CourseVersion as CV
    course, v = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01",
              "end_date": "2026-12-31", "groups_enabled": False},
    ).json()
    db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
    db.commit()
    asset = _upload_asset(admin_client, v["id"], filename=filename)
    if state != "published" or is_disabled:
        updates = {}
        if state != "published":
            updates["state"] = state
        if is_disabled:
            updates["is_disabled"] = True
        db.query(CV).filter(CV.id == v["id"]).update(updates)
        db.commit()
    return course, v, filename, asset


class TestServeAssetTeacherAccess:
    def test_allows_teacher_on_pinned_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        r = teacher_client.get(f"/assets/{v['id']}/{fn}")
        assert r.status_code == 200, r.text
        assert r.content == b"PNGDATA"

    def test_rejects_teacher_on_pinned_disabled_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
            is_disabled=True,
        )
        r = teacher_client.get(f"/assets/{v['id']}/{fn}")
        # is_disabled short-circuit at assets.py:139 — admin-symmetric (everyone 403s)
        assert r.status_code == 403

    def test_allows_teacher_on_pinned_draft_state_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, fn, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
            state="created",
        )
        r = teacher_client.get(f"/assets/{v['id']}/{fn}")
        assert r.status_code == 200

    def test_rejects_teacher_on_unpinned_version(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import Run
        course, v1 = seed_publishable_version()
        v2 = admin_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        ).json()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.query(Run).filter(Run.id == run["id"]).update({"version_id": v1["id"]})
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        _upload_asset(admin_client, v2["id"], "logo.png")
        r = teacher_client.get(f"/assets/{v2['id']}/logo.png")
        assert r.status_code == 403

    def test_assets_serve_still_rejects_non_member(
        self, teacher_client, admin_client, seed_publishable_version,
    ):
        _, v = seed_publishable_version()
        _upload_asset(admin_client, v["id"], "logo.png")
        r = teacher_client.get(f"/assets/{v['id']}/logo.png")
        assert r.status_code == 403

    def test_assets_list_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, _, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        # The admin-only listing endpoint
        r = teacher_client.get(f"/api/versions/{v['id']}/assets")
        assert r.status_code == 403

    def test_assets_upload_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        _, v, _, _ = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        r = teacher_client.post(
            f"/api/versions/{v['id']}/assets",
            files={"file": ("evil.png", b"X", "image/png")},
        )
        assert r.status_code == 403

    def test_assets_delete_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        # NOTE (deviation from plan): the plan called DELETE on
        # /api/versions/{vid}/assets/{fn} but that route doesn't exist — the
        # real delete endpoint is /api/assets/{asset_id}. Adapted to use the
        # asset id returned by the upload helper. Intent (teacher cannot
        # delete) is preserved.
        _, _, _, asset = _seed_teacher_with_pinned_version_and_asset(
            db, admin_client, teacher_user, seed_publishable_version,
        )
        r = teacher_client.delete(f"/api/assets/{asset['id']}")
        assert r.status_code == 403


class TestCascadeGuards:
    """Lock: opening /blocks does NOT cascade to authoring leaves."""

    def test_sequences_list_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        # Locate the seeded block id via admin
        blocks = admin_client.get(f"/api/versions/{v['id']}/blocks").json()
        assert blocks, "fixture seed should create a block"
        block_id = blocks[0]["id"]
        r = teacher_client.get(f"/api/blocks/{block_id}/sequences")
        assert r.status_code == 403

    def test_items_list_still_admin_only_for_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        blocks = admin_client.get(f"/api/versions/{v['id']}/blocks").json()
        seqs = admin_client.get(f"/api/blocks/{blocks[0]['id']}/sequences").json()
        assert seqs
        r = teacher_client.get(f"/api/sequences/{seqs[0]['id']}/items")
        assert r.status_code == 403

    def test_versions_write_still_admin_only(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.post(
            f"/api/courses/{course['id']}/versions", json={"info_md": ""}
        )
        assert r.status_code == 403


# ============================================================================
# T4: GET /api/teaching/runs endpoint tests
# ============================================================================


class TestTeachingRunsEndpoint:
    def test_returns_only_my_runs(
        self, teacher_client, teacher_user, admin_client,
        seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        my_run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "Mine", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        other_run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "NotMine", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=my_run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        rows = r.json()
        ids = [row["run"]["id"] for row in rows]
        assert my_run["id"] in ids
        assert other_run["id"] not in ids

    def test_empty(self, teacher_client):
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []

    def test_excludes_runs_without_teacher_row(
        self, teacher_client, admin_client, seed_publishable_version,
    ):
        # Spec §6.1 names this case as a standalone test. A Run exists but no
        # RunTeacher row links the requesting user to it → response is empty.
        # Functionally also covered by test_returns_only_my_runs (the unowned
        # half of that two-run setup), but the spec lists it by name and a
        # dedicated lock makes the invariant obvious in the test report.
        course, _ = seed_publishable_version()
        admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "Unowned", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        )
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []

    def test_student_count_zero(
        self, teacher_client, teacher_user, admin_client,
        seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.json()[0]["student_count"] == 0

    def test_student_count_multiple(
        self, teacher_client, teacher_user, admin_client,
        seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": True},
        ).json()
        # Add teacher and publish before adding students (§8 gate).
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        pub = admin_client.post(f"/api/runs/{run['id']}/publish")
        assert pub.status_code == 200, pub.json()
        # Add students via admin (run is now published).
        admin_client.post(f"/api/runs/{run['id']}/students",
                          json={"email": "s1@x"})
        admin_client.post(f"/api/runs/{run['id']}/students",
                          json={"email": "s2@x"})
        admin_client.post(f"/api/runs/{run['id']}/students",
                          json={"email": "s3@x"})
        r = teacher_client.get("/api/teaching/runs")
        assert r.json()[0]["student_count"] == 3

    def test_superuser_sees_only_own_teacher_rows(
        self, admin_client, seed_publishable_version,
    ):
        # Superuser → NO RunTeacher row → empty response (NO superuser bypass).
        # A Run MUST exist so the test would catch a hypothetical bypass branch
        # like `if user.is_superuser: return db.query(Run).all()`. Without the
        # run, the assertion would falsely pass against such a regression.
        course, _ = seed_publishable_version()
        admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "NotMine", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        )
        r = admin_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []

    def test_excludes_runs_where_user_is_course_admin_but_not_teacher(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        # Make teacher_user a CourseAdmin but NOT a RunTeacher
        db.add(CourseAdmin(user_id=teacher_user.id, course_id=course["id"]))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        assert r.status_code == 200
        assert r.json() == []
        # sanity: the run exists
        assert run["id"]

    def test_orders_by_id_asc(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        r1 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R1", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        r2 = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R2", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=r1["id"], user_id=teacher_user.id))
        db.add(RunTeacher(run_id=r2["id"], user_id=teacher_user.id))
        db.commit()
        r = teacher_client.get("/api/teaching/runs")
        ids = [row["run"]["id"] for row in r.json()]
        # Lock the exact ASC order, not just `sorted(ids)` (which trivially
        # passes for 0- or 1-element lists and wouldn't catch a regression
        # that limited / filtered the response down to a single row).
        assert ids == [r1["id"], r2["id"]]

    def test_excludes_runs_on_other_courses(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        # Teacher on course A must NOT see runs from course B. Locks the
        # RunTeacher → Run → CourseVersion → Course join chain against a
        # regression that widened cross-course.
        course_a, _ = seed_publishable_version(slug="course-a", name="Course A")
        course_b, _ = seed_publishable_version(slug="course-b", name="Course B")
        run_a = admin_client.post(
            f"/api/courses/{course_a['id']}/runs",
            json={"title": "RA", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        run_b = admin_client.post(
            f"/api/courses/{course_b['id']}/runs",
            json={"title": "RB", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run_a["id"], user_id=teacher_user.id))
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        ids = [row["run"]["id"] for row in body]
        assert run_a["id"] in ids
        assert run_b["id"] not in ids
        # And confirm the surfaced row carries course A's identity, not B's
        a_row = next(row for row in body if row["run"]["id"] == run_a["id"])
        assert a_row["course_id"] == course_a["id"]
        assert a_row["course_slug"] == course_a["slug"]

    def test_response_key_set(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        assert len(body) == 1
        row = body[0]
        assert set(row.keys()) == {"run", "course_id", "course_name",
                                   "course_slug", "student_count"}
        for k in ("id", "title", "start_date", "end_date", "is_published",
                  "created_at"):
            assert k in row["run"], f"missing {k!r} in nested run"

    def test_course_slug_populated(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        row = teacher_client.get("/api/teaching/runs").json()[0]
        assert row["course_slug"] == course["slug"]
        assert row["course_slug"]  # non-empty

    def test_includes_runs_pinned_to_disabled_versions(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        from mathion.models import CourseVersion as CV
        course, v = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.query(CV).filter(CV.id == v["id"]).update({"is_disabled": True})
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        assert any(row["run"]["id"] == run["id"] for row in body)

    def test_includes_unpublished_draft_runs(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.commit()
        # Run is unpublished by default — included
        body = teacher_client.get("/api/teaching/runs").json()
        ids = [row["run"]["id"] for row in body]
        assert run["id"] in ids
        assert any(not row["run"]["is_published"] for row in body)

    def test_returns_run_when_user_is_one_of_multiple_teachers(
        self, teacher_client, teacher_user, admin_client, seed_publishable_version, db,
    ):
        other = User(email="other@x", full_name="Other")
        db.add(other); db.commit(); db.refresh(other)
        course, _ = seed_publishable_version()
        run = admin_client.post(
            f"/api/courses/{course['id']}/runs",
            json={"title": "R", "start_date": "2026-01-01",
                  "end_date": "2026-12-31", "groups_enabled": False},
        ).json()
        db.add(RunTeacher(run_id=run["id"], user_id=teacher_user.id))
        db.add(RunTeacher(run_id=run["id"], user_id=other.id))
        db.commit()
        body = teacher_client.get("/api/teaching/runs").json()
        run_ids = [row["run"]["id"] for row in body]
        # exactly one row, no duplication despite the two-teacher row
        assert run_ids.count(run["id"]) == 1
