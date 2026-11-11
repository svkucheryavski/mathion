"""One place builds a course's sign-in address (D8):
step 3's done view and the Courses note must never differ."""
from mathion.config import settings
from mathion.course_links import course_sign_in_url


def test_course_sign_in_url(monkeypatch):
    monkeypatch.setattr(settings, "base_url", "https://learn.uni.dk")
    assert course_sign_in_url("algebra") == "https://learn.uni.dk/courses/algebra/edit"


def test_course_sign_in_url_on_a_given_base():
    # The admin's email renders with its own context's base (notifications).
    assert course_sign_in_url("stat", "https://m.x") == "https://m.x/courses/stat/edit"


def test_course_sign_in_url_on_an_empty_base(monkeypatch):
    # A given base is used as it is, even an empty one; only None reads settings.
    monkeypatch.setattr(settings, "base_url", "https://learn.uni.dk")
    assert course_sign_in_url("s", "") == "/courses/s/edit"
