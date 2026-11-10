"""The panel's Set up wizard: the state read and the wizard's writes
(superuser Set up spec D4, D4a, D5, D5a, D10, D12, D13)."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from mathion import setup_state
from mathion.config import settings
from mathion.course_links import course_sign_in_url
from mathion.main import app
from mathion.models import Course, CourseAdmin
from mathion.models_auth import SiteBranding, SiteSetup, User
from mathion.site_settings import load
from mathion.superuser import service as panel_service
from tests.conftest import set_site

EMAIL_OFF = "Email is off."
SITE_MATHION = "The site is still called Mathion."
BAD_STEP = "The step must be from 1 to 4."


@pytest.fixture
def panel(admin_client, db, monkeypatch):
    """(client, base path) for a superuser with a live panel token; the panel decides email."""
    monkeypatch.setattr(settings, "email_mode", "disabled")
    token = panel_service.mint(db)
    return admin_client, f"/api/superuser/{token}"


def _on(db, step=1, mask=0, on=True):
    db.add(SiteSetup(id=1, wizard_on=on, step=step, passed_mask=mask))
    db.commit()


def _stored(db):
    db.expire_all()
    row = db.get(SiteSetup, 1)
    return None if row is None else (row.wizard_on, row.step, row.passed_mask)


def _kept(db):
    db.expire_all()
    v = load(db)
    return v.site_name_kept, v.sign_in_kept


def _ok(r) -> dict:
    assert r.status_code == 200, r.text
    return r.json()


def _get(panel) -> dict:
    client, base = panel
    return _ok(client.get(f"{base}/setup"))


def _write(panel, what: str, step: int | None = None):
    client, base = panel
    return client.post(f"{base}/setup/{what}", json=None if step is None else {"step": step})


def _marks(state) -> list[tuple[bool, bool]]:
    return [(s["passed"], s["done"]) for s in state["steps"]]


# --- the read ---

def test_missing_row_reads_over(panel, db):
    state = _get(panel)
    assert (state["wizard_on"], state["step"]) == (False, 1)


def test_missing_table_reads_over(db):
    with db.begin_nested() as outer:
        db.execute(text("ALTER TABLE site_setup RENAME TO site_setup_gone"))
        state = setup_state.read(db)
        outer.rollback()
    assert (state.wizard_on, state.step) == (False, 1)


def test_read_fresh_site(panel, db):
    _on(db)
    state = _get(panel)
    assert (state["wizard_on"], state["step"]) == (True, 1)
    assert _marks(state) == [(False, False)] * 4
    assert [s["reason"] for s in state["steps"]] == [EMAIL_OFF, SITE_MATHION, None, None]
    assert (state["course"], state["course_without_admin"]) == (None, None)
    assert (state["email_set_up"], state["pin_minutes"], state["defaults_in_use"]) == (False, 10, True)


def test_read_loads_the_settings_once(db, monkeypatch):
    # Whole-branch M3: "email set up" comes from the view the done rules loaded.
    from mathion.api import superuser_courses
    calls = []
    real = setup_state.load_site
    for module in (setup_state, superuser_courses):
        monkeypatch.setattr(module, "load_site", lambda d: calls.append(1) or real(d))
    set_site(db, email_on=True)
    assert setup_state.read(db).email_set_up is True
    assert len(calls) == 1


def test_done_step_counts_as_passed(panel, db):
    _on(db)
    db.add(SiteBranding(id=1, site_name="Lund", theme_changes={}))
    db.commit()
    state = _get(panel)
    assert _marks(state)[1] == (True, True)
    assert state["steps"][1]["reason"] is None
    assert (state["wizard_on"], state["step"]) == (True, 1)


def test_read_with_all_done_ends_it(panel, db):
    # D5a: every step done on its own page, the wizard still on.
    set_site(db, email_on=True, smtp_host="mail.uni.dk", email_from="noreply@uni.dk", card_test_ok=True,
             card_test_at=datetime.now(timezone.utc), site_name_kept=True, sign_in_kept=True)
    ann = User(email="ann@uni.dk")
    db.add(ann)
    db.flush()
    db.add(Course(id=1, slug="algebra", name="Algebra"))
    db.flush()
    db.add(CourseAdmin(course_id=1, user_id=ann.id))
    db.commit()
    _on(db, step=2)
    state = _get(panel)
    assert _marks(state) == [(True, True)] * 4
    assert state["wizard_on"] is False
    assert _stored(db)[0] is False


def test_course_facts_in_answer(panel, db, monkeypatch):
    set_site(db, pin_minutes=15)
    ann = User(email="ann@uni.dk", full_name="Ann", is_disabled=True)
    db.add(ann)
    db.flush()
    db.add(Course(id=1, slug="algebra", name="Algebra"))
    db.flush()
    db.add(CourseAdmin(course_id=1, user_id=ann.id))
    db.commit()
    state = _get(panel)
    course = state["course"]
    assert (course["name"], course["sign_in_url"]) == ("Algebra", course_sign_in_url("algebra"))
    assert (course["admin"]["email"], course["admin"]["full_name"], course["admin"]["is_disabled"]) == (
        "ann@uni.dk", "Ann", True)
    assert _marks(state)[2] == (True, True)
    assert (state["course_without_admin"], state["pin_minutes"], state["email_set_up"]) == (None, 15, False)
    monkeypatch.setattr(settings, "email_mode", "file")
    assert _get(panel)["email_set_up"] is True


def test_course_without_admin_in_answer(panel, db):
    db.add(Course(id=4, slug="stats", name="Statistics"))
    db.add(Course(id=2, slug="algebra", name="Algebra"))
    db.commit()
    state = _get(panel)
    assert (state["course"], state["course_without_admin"]) == (None, "Algebra")
    assert _marks(state)[2] == (False, False)


def test_defaults_in_use_follows_settings(panel, db):
    set_site(db, max_total_mb=800)
    assert _get(panel)["defaults_in_use"] is False


# --- the wizard's writes (D4, D4a, D5) ---

def test_skip_moves_to_next_not_passed(panel, db):
    _on(db)
    state = _ok(_write(panel, "skip", 1))
    assert (state["wizard_on"], state["step"]) == (True, 2)
    assert _marks(state)[0] == (True, False)
    assert _stored(db) == (True, 2, 0b0001)


def test_skip_keeps_defaults(panel, db):
    _on(db)
    _ok(_write(panel, "skip", 1))
    state = _ok(_write(panel, "skip", 2))
    assert _marks(state)[:2] == [(True, False), (True, True)]
    assert _kept(db) == (True, False)
    state = _ok(_write(panel, "skip", 3))
    assert _marks(state)[2] == (True, False)
    assert state["step"] == 4
    state = _ok(_write(panel, "skip", 4))
    assert _marks(state) == [(True, False), (True, True), (True, False), (True, True)]
    assert _kept(db) == (True, True)


def test_logo_only_save_counts(panel, db):
    # D7: "step 2 saved" with the name still Mathion (a logo alone) is done.
    _on(db, step=2)
    state = _ok(_write(panel, "saved", 2))
    assert _marks(state)[1] == (True, True)
    assert state["step"] == 3
    assert _kept(db) == (True, False)


def test_saved_step_4_doesnt_mark_kept(panel, db):
    # The keep-sign-in write marks D9; "step 4 saved" only passes the step.
    _on(db, step=4)
    state = _ok(_write(panel, "saved", 4))
    assert _marks(state)[3] == (True, False)
    assert _kept(db) == (False, False)


def test_go_sets_the_step(panel, db):
    _on(db)
    state = _ok(_write(panel, "go", 3))
    assert (state["wizard_on"], state["step"]) == (True, 3)
    assert _marks(state) == [(False, False)] * 4
    assert _stored(db) == (True, 3, 0)


def test_saved_wraps_to_first_not_passed(panel, db):
    # D5: jumping to step 4 first and saving moves on, it doesn't end.
    _on(db, mask=0b0110)
    _ok(_write(panel, "go", 4))
    state = _ok(_write(panel, "saved", 4))
    assert (state["wizard_on"], state["step"]) == (True, 1)
    assert _stored(db) == (True, 1, 0b1110)


def test_next_skips_steps_done_elsewhere(panel, db):
    _on(db)
    db.add(SiteBranding(id=1, site_name="Lund", theme_changes={}))
    db.commit()
    state = _ok(_write(panel, "skip", 1))
    assert state["step"] == 3


def test_last_not_passed_ends_wizard(panel, db):
    _on(db)
    for n in (1, 2, 3):
        assert _ok(_write(panel, "skip", n))["wizard_on"] is True
    state = _ok(_write(panel, "skip", 4))
    assert state["wizard_on"] is False
    assert _stored(db)[0] is False
    assert _get(panel)["wizard_on"] is False


def test_late_writes_answer_200_with_state(panel, db):
    # D5a: a write after the wizard is over changes nothing, the kept marks included.
    _on(db, step=2, mask=0b0001, on=False)
    for what, n in (("go", 3), ("skip", 2), ("saved", 2), ("skip", 4), ("saved", 3)):
        state = _ok(_write(panel, what, n))
        assert state["wizard_on"] is False, (what, n)
    assert _stored(db) == (False, 2, 0b0001)
    assert _kept(db) == (False, False)


def test_writes_with_no_row_change_nothing(panel, db):
    for what, n in (("go", 3), ("skip", 2), ("saved", 2), ("skip", 4)):
        assert _ok(_write(panel, what, n))["wizard_on"] is False
    assert _stored(db) is None
    assert _kept(db) == (False, False)


def test_keep_sign_in_any_state(panel, db):
    # D12: not a wizard write; it marks D9 whether the wizard is on or over.
    state = _ok(_write(panel, "keep-sign-in"))
    assert (state["wizard_on"], _marks(state)[3]) == (False, (True, True))
    assert _stored(db) is None

    set_site(db, sign_in_kept=False)
    _on(db, step=2)
    state = _ok(_write(panel, "keep-sign-in"))
    assert (state["wizard_on"], state["step"], _marks(state)[3]) == (True, 2, (True, True))

    set_site(db, sign_in_kept=False)
    db.get(SiteSetup, 1).passed_mask = 0b0111
    db.commit()
    state = _ok(_write(panel, "keep-sign-in"))
    assert state["wizard_on"] is False   # step 4 was the last not passed
    assert _stored(db)[0] is False


# --- input and the guard ---

@pytest.mark.parametrize("what", ["go", "skip", "saved"])
@pytest.mark.parametrize("step", [0, 5, -1])
def test_bad_step_is_422(panel, db, what, step):
    _on(db)
    r = _write(panel, what, step)
    assert (r.status_code, r.json()["detail"]) == (422, BAD_STEP)
    assert _stored(db) == (True, 1, 0)


def test_missing_step_is_422(panel, db):
    client, base = panel
    assert client.post(f"{base}/setup/go", json={}).status_code == 422


def test_writes_need_csrf(panel, db):
    _on(db)
    client, base = panel
    plain = TestClient(app)
    plain.cookies = client.cookies
    for what, body in (("go", {"step": 2}), ("skip", {"step": 1}), ("saved", {"step": 1}), ("keep-sign-in", None)):
        r = plain.post(f"{base}/setup/{what}", json=body)
        assert r.status_code == 403, (what, r.status_code)
    assert _stored(db) == (True, 1, 0)
    assert _kept(db) == (False, False)


def test_expired_token_404(admin_client):
    assert admin_client.get("/api/superuser/not-a-token/setup").status_code == 404
    assert admin_client.post("/api/superuser/not-a-token/setup/go", json={"step": 2}).status_code == 404
    assert admin_client.post("/api/superuser/not-a-token/setup/keep-sign-in").status_code == 404
