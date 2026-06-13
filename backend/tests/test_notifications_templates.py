from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from mathion.notifications.templates import (
    TEMPLATES, RenderContext, render, _name, _run_url,
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


def test_run_url_no_query():
    ctx = _ctx()
    url = _run_url(ctx)
    assert url == "http://localhost:8000/courses/calc-101/runs/42"
    assert "?" not in url and "#" not in url


def test_course_slug_property_derives_live():
    ctx = _ctx()
    assert ctx.course_slug == "calc-101"
    ctx.run.version.course.slug = "new-slug"
    assert ctx.course_slug == "new-slug"


def test_run_url_handles_trailing_slash_already_stripped():
    ctx = _ctx(base_url="http://localhost:8000")
    assert _run_url(ctx) == "http://localhost:8000/courses/calc-101/runs/42"


@pytest.mark.parametrize("kind", [
    "evaluation_received", "run_enrolled",
    "run_teacher_assigned", "mini_project_published",
])
def test_each_kind_renders(kind):
    ctx = _ctx()
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Block 3 Project"):
        subject, body = render(kind, ctx)
        assert "Alice" in body
        assert "http://localhost:8000/courses/calc-101/runs/42" in body
        assert subject and not subject.endswith("\n")


def test_evaluation_received_uses_mp_title_helper():
    ctx = _ctx()
    with patch("mathion.api.mini_projects.mini_project_title", return_value="Special MP Title"):
        subject, body = render("evaluation_received", ctx)
        assert "Special MP Title" in body


def test_render_unknown_kind_raises():
    with pytest.raises(KeyError):
        render("not_a_real_kind", _ctx())


def test_templates_dict_has_4_keys():
    assert set(TEMPLATES.keys()) == {
        "evaluation_received", "run_enrolled",
        "run_teacher_assigned", "mini_project_published",
    }
