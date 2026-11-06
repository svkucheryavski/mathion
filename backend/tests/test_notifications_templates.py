from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import pytest

NAME_WITH_EMOJI = 'Riverside \U0001f3eb Sk\u00f8le'

from mathion.notifications.templates import (
    TEMPLATES, RenderContext, render, _name, _student_url, _staff_url, _build_email_message,
)


def _ctx(**overrides):
    user = SimpleNamespace(full_name="Alice", email="alice@example.com")
    course = SimpleNamespace(slug="calc-101")
    version = SimpleNamespace(course=course)
    run = SimpleNamespace(id=42, title="Spring 2026", version=version)
    mp = SimpleNamespace(block=SimpleNamespace(title="Block 3"), id=7)
    sub = SimpleNamespace(id=99)
    base = dict(user=user, run=run, base_url="http://localhost:8000", mp=mp, sub=sub)
    base.update(overrides)
    return RenderContext(**base)


def test_name_uses_full_name():
    user = SimpleNamespace(full_name="Bob", email="b@x")
    assert _name(user) == "Bob"


def test_name_falls_back_to_email():
    user = SimpleNamespace(full_name=None, email="b@x")
    assert _name(user) == "b@x"


def test_student_url_no_query():
    ctx = _ctx()
    url = _student_url(ctx)
    assert url == "http://localhost:8000/courses/calc-101"
    assert "?" not in url and "#" not in url


def test_staff_url_no_query():
    ctx = _ctx()
    url = _staff_url(ctx)
    assert url == "http://localhost:8000/teaching/calc-101/runs/42"  # Polish 3 C9
    assert "?" not in url and "#" not in url


def test_course_slug_property_derives_live():
    ctx = _ctx()
    assert ctx.course_slug == "calc-101"
    ctx.run.version.course.slug = "new-slug"
    assert ctx.course_slug == "new-slug"


@pytest.mark.parametrize("kind,expected_url", [
    ("evaluation_received",   "http://localhost:8000/courses/calc-101"),
    ("run_enrolled",          "http://localhost:8000/courses/calc-101"),
    ("run_teacher_assigned",  "http://localhost:8000/teaching/calc-101/runs/42"),
    ("mini_project_published", "http://localhost:8000/courses/calc-101"),
])
def test_each_kind_renders(kind, expected_url):
    ctx = _ctx()
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Block 3 Project"):
        subject, body = render(kind, ctx)
        assert "Alice" in body
        assert expected_url in body
        assert subject and not subject.endswith("\n")


def test_evaluation_received_uses_mp_title_helper():
    ctx = _ctx()
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Special MP Title"):
        subject, body = render("evaluation_received", ctx)
        assert "Special MP Title" in body


def test_render_unknown_kind_raises():
    with pytest.raises(KeyError):
        render("not_a_real_kind", _ctx())


def test_templates_dict_has_5_keys():
    assert set(TEMPLATES.keys()) == {
        "evaluation_received", "run_enrolled",
        "run_teacher_assigned", "mini_project_published",
        "course_admin_assigned",
    }


def test_course_admin_assigned_renders():
    # D5: a course-scoped email; no run in the context.
    ctx = RenderContext(
        user=SimpleNamespace(full_name=None, email="a@x"),
        base_url="https://m.x",
        course=SimpleNamespace(name="Statistics 101", slug="stat"),
    )
    subject, body = render("course_admin_assigned", ctx)
    assert subject == "You are now the admin of Statistics 101"
    assert body.startswith("Hi a@x,")
    assert "https://m.x/courses/stat/edit" in body


def test_build_email_message_raises_on_missing_email():
    user_no_email = SimpleNamespace(full_name="X", email="")
    ctx = _ctx()
    ctx.user = user_no_email
    with pytest.raises(ValueError, match="recipient has no email"):
        _build_email_message("subj", "body", ctx, kind="run_enrolled")


def test_build_email_message_sets_headers():
    ctx = _ctx()
    msg = _build_email_message("Hi", "Body text", ctx, kind="run_enrolled")
    assert msg["To"] == "alice@example.com"
    assert msg["Subject"] == "Hi"
    assert msg["X-Mathion-Kind"] == "run_enrolled"
    assert "Body text" in msg.get_content()


def test_build_email_message_set_content_uses_utf8():
    ctx = _ctx()
    msg = _build_email_message("Hi", "héllo wörld", ctx, kind="run_enrolled")
    # set_content(..., charset="utf-8") writes a 7bit-friendly representation;
    # round-tripping via get_content() should decode the unicode losslessly.
    assert "héllo wörld" in msg.get_content()


# --- superuser Branding D3: the site name signs every email ---

@pytest.mark.parametrize("kind", sorted(TEMPLATES))
def test_sign_off_uses_the_site_name(kind):
    ctx = _ctx(course=SimpleNamespace(name="Statistics 101", slug="stat"))
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Block 3 Project"):
        subject, body = render(kind, replace(ctx, site_name="Riverside"))
        default_subject, default_body = render(kind, ctx)
    assert body.endswith("\n\n— Riverside\n")
    assert default_body.endswith("\n\n— Mathion\n")
    assert subject == default_subject  # subjects name the run or the course
    assert "Mathion" not in body


def test_admin_note_names_the_site():
    ctx = RenderContext(user=SimpleNamespace(full_name=None, email="a@x"), base_url="https://m.x",
                        course=SimpleNamespace(name="Statistics 101", slug="stat"), site_name="Riverside")
    _subject, body = render("course_admin_assigned", ctx)
    assert 'You are now the admin of "Statistics 101" on Riverside. ' in body


def test_render_context_defaults_to_mathion():
    assert _ctx().site_name == "Mathion"


def test_pin_email_uses_the_site_name():
    from mathion.notifications.templates import build_login_pin_message
    msg = build_login_pin_message("a@x.dk", "123456", minutes=15, site_name="Riverside")
    assert msg["Subject"] == "Your Riverside sign-in PIN"
    assert msg.get_content() == "Your Riverside sign-in PIN is 123456. It expires in 15 minutes.\n"
    default = build_login_pin_message("a@x.dk", "123456", minutes=15)
    assert default["Subject"] == "Your Mathion sign-in PIN"


def test_pin_email_subject_keeps_emoji_and_accents():
    from email import message_from_bytes, policy
    from mathion.notifications.templates import build_login_pin_message
    name = NAME_WITH_EMOJI
    msg = build_login_pin_message("a@x.dk", "123456", minutes=15, site_name=name)
    back = message_from_bytes(msg.as_bytes(), policy=policy.default)
    assert back["Subject"] == f"Your {name} sign-in PIN"
    assert back.get_content().startswith(f"Your {name} sign-in PIN is 123456.")
