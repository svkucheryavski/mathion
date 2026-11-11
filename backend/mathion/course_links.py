"""A course's sign-in address, built in one place: the Courses note, Set up
step 3 and the "You are now the admin" email all show it (superuser
Users/Courses D5a, Set up D8)."""
from mathion.config import settings


def course_sign_in_url(slug: str, base_url: str | None = None) -> str:
    return f"{settings.base_url if base_url is None else base_url}/courses/{slug}/edit"
