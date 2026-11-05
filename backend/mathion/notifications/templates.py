from dataclasses import dataclass
from typing import Optional, Callable

from email.message import EmailMessage

from mathion.config import settings
from mathion.models import Course, Run, MiniProject, Submission
from mathion.models_auth import User


# D5: the one course-scoped kind (payload {"course_id": …}); every other kind is run-scoped.
COURSE_ADMIN_ASSIGNED = "course_admin_assigned"


@dataclass
class RenderContext:
    user: User
    base_url: str
    run: Optional[Run] = None
    course: Optional[Course] = None  # set instead of `run` for a course-scoped kind
    mp: Optional[MiniProject] = None
    sub: Optional[Submission] = None

    @property
    def course_slug(self) -> str:
        if self.run is not None:
            return self.run.version.course.slug
        return self.course.slug


def _name(u) -> str:
    return u.full_name or u.email


def _student_url(ctx) -> str:
    """Student-facing URL — lands on the course view they can access."""
    return f"{ctx.base_url}/courses/{ctx.course_slug}"


def _staff_url(ctx) -> str:
    """Teacher/admin-facing URL — lands on the run detail page (Polish 3 C9:
    the /teaching address; the old /courses/… route still redirects)."""
    return f"{ctx.base_url}/teaching/{ctx.course_slug}/runs/{ctx.run.id}"


def _evaluation_received(ctx):
    from mathion.api.mini_projects import mini_project_title
    subject = f"New evaluation in {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'Your submission to "{mini_project_title(ctx.mp.block)}" has been evaluated.\n\n'
        f"View it: {_student_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body


def _run_enrolled(ctx):
    subject = f"You've been enrolled in {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'You\'ve been enrolled in "{ctx.run.title}".\n\n'
        f"Open it: {_student_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body


def _run_teacher_assigned(ctx):
    subject = f"You're teaching {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'You\'ve been assigned as a teacher on "{ctx.run.title}".\n\n'
        f"Open it: {_staff_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body


def _mini_project_published(ctx):
    from mathion.api.mini_projects import mini_project_title
    subject = f"New mini-project in {ctx.run.title}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'A new mini-project "{mini_project_title(ctx.mp.block)}" is available in "{ctx.run.title}".\n\n'
        f"Open it: {_student_url(ctx)}\n\n"
        "— Mathion\n")
    return subject, body


def _course_admin_assigned(ctx):
    subject = f"You are now the admin of {ctx.course.name}"
    body = (
        f"Hi {_name(ctx.user)},\n\n"
        f'You are now the admin of "{ctx.course.name}" on Mathion. '
        "You can work on it in the course editor.\n\n"
        f"Open it: {ctx.base_url}/courses/{ctx.course_slug}/edit\n\n"
        "— Mathion\n")
    return subject, body


TEMPLATES: dict[str, Callable[[RenderContext], tuple[str, str]]] = {
    "evaluation_received":     _evaluation_received,
    "run_enrolled":            _run_enrolled,
    "run_teacher_assigned":    _run_teacher_assigned,
    "mini_project_published":  _mini_project_published,
    COURSE_ADMIN_ASSIGNED:     _course_admin_assigned,
}


def render(kind, ctx):
    if kind not in TEMPLATES:
        raise KeyError(f"unknown notification kind: {kind!r}")
    return TEMPLATES[kind](ctx)


def _build_email_message(subject, body, ctx, *, kind: str) -> EmailMessage:
    if not ctx.user.email:
        raise ValueError("recipient has no email")  # → permanent
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = ctx.user.email
    msg["Subject"] = subject  # EmailMessage default policy raises ValueError on CR/LF → permanent
    msg["X-Mathion-Kind"] = kind  # FileMailer reads this to name the .eml file
    msg.set_content(body, charset="utf-8")
    return msg


LOGIN_PIN_KIND = "login_pin"


def build_login_pin_message(email: str, pin: str, *, minutes: int) -> EmailMessage:
    """Standalone login-PIN email. Not a TEMPLATES entry (those are
    RenderContext -> (subject, body) callables). The raw PIN lives only in this
    in-memory message — never persisted or logged."""
    if not email:
        raise ValueError("recipient has no email")
    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = email  # EmailMessage default policy rejects CR/LF-injected headers
    msg["Subject"] = "Your Mathion sign-in PIN"
    msg["X-Mathion-Kind"] = LOGIN_PIN_KIND
    msg.set_content(
        f"Your Mathion sign-in PIN is {pin}. "
        f"It expires in {minutes} minutes.",
        charset="utf-8",
    )
    return msg
