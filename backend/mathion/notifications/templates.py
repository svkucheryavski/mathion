from dataclasses import dataclass
from typing import Optional, Callable

from email.message import EmailMessage

from mathion.config import settings
from mathion.models import Run, MiniProject, Submission
from mathion.models_auth import User


@dataclass
class RenderContext:
    user: User
    run: Run
    base_url: str
    mp: Optional[MiniProject] = None
    sub: Optional[Submission] = None

    @property
    def course_slug(self) -> str:
        return self.run.version.course.slug


def _name(u) -> str:
    return u.full_name or u.email


def _student_url(ctx) -> str:
    """Student-facing URL — lands on the course view they can access."""
    return f"{ctx.base_url}/courses/{ctx.course_slug}"


def _staff_url(ctx) -> str:
    """Teacher/admin-facing URL — lands on the run detail page."""
    return f"{ctx.base_url}/courses/{ctx.course_slug}/runs/{ctx.run.id}"


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


TEMPLATES: dict[str, Callable[[RenderContext], tuple[str, str]]] = {
    "evaluation_received":     _evaluation_received,
    "run_enrolled":            _run_enrolled,
    "run_teacher_assigned":    _run_teacher_assigned,
    "mini_project_published":  _mini_project_published,
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
