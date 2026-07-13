import pytest

from mathion.auth import verify_pin
from mathion.models_auth import User
from mathion.superuser import service as panel_service
from mathion.superuser.service import (
    ActivateResult, DisabledUser, PinIssued, RateLimited, UnknownUser,
    activate_panel, create_or_promote_superuser, issue_bootstrap_pin,
)


def test_create_new_superuser(db):
    user = create_or_promote_superuser(db, "New.Admin@Example.com  ")
    assert user.email == "new.admin@example.com"      # normalized
    assert user.is_superuser is True


def test_promote_existing_user(db):
    db.add(User(email="u@example.com"))
    db.commit()
    user = create_or_promote_superuser(db, "u@example.com")
    assert user.is_superuser is True


def test_reenables_disabled_user(db):
    db.add(User(email="d@example.com", is_disabled=True))
    db.commit()
    user = create_or_promote_superuser(db, "d@example.com")
    assert user.is_superuser is True
    assert user.is_disabled is False


def test_mixed_case_email_collapses_to_one_row(db):
    create_or_promote_superuser(db, "Case@Example.com")
    create_or_promote_superuser(db, "case@example.com")
    rows = db.query(User).filter(User.email == "case@example.com").all()
    assert len(rows) == 1


@pytest.mark.parametrize("bad", ["", "   ", "a" * 255 + "@x.com"])
def test_rejects_empty_or_oversized_email(db, bad):
    with pytest.raises(ValueError):
        create_or_promote_superuser(db, bad)


def test_issue_pin_for_known_user(db):
    create_or_promote_superuser(db, "p@example.com")
    result = issue_bootstrap_pin(db, "p@example.com")
    assert isinstance(result, PinIssued)
    assert verify_pin(db, "p@example.com", result.pin, duration_days=1) is not None


def test_issue_pin_unknown_user(db):
    assert isinstance(issue_bootstrap_pin(db, "ghost@example.com"), UnknownUser)


def test_issue_pin_disabled_user(db):
    db.add(User(email="off@example.com", is_disabled=True))
    db.commit()
    assert isinstance(issue_bootstrap_pin(db, "off@example.com"), DisabledUser)


def test_issue_pin_rate_limited(db):
    create_or_promote_superuser(db, "rl@example.com")
    for _ in range(3):   # settings.max_pin_requests_per_hour default is 3
        issue_bootstrap_pin(db, "rl@example.com")
    assert isinstance(issue_bootstrap_pin(db, "rl@example.com"), RateLimited)


def test_activate_no_superuser_warns(db):
    result = activate_panel(db)
    assert isinstance(result, ActivateResult)
    assert result.has_superuser is False
    assert result.url.endswith(f"/superuser/{result.token}")


def test_activate_reports_superuser_and_supersedes(db):
    create_or_promote_superuser(db, "s@example.com")
    first = activate_panel(db)
    second = activate_panel(db)
    assert second.has_superuser is True
    # first token is superseded
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        panel_service.validate(db, first.token)
    assert panel_service.validate(db, second.token) is not None
