import re
from datetime import datetime, timezone


_NON_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """Lowercase, collapse runs of non-[a-z0-9] into single dashes, strip
    leading/trailing dashes. Returns '' for titles with no Latin letters or
    digits (Cyrillic, emoji, punctuation only) — caller is responsible for
    rejecting empty results."""
    return _NON_SLUG.sub("-", title.lower()).strip("-")


def bump_content_updated_at(version) -> None:
    """Mark a CourseVersion's content as updated (for ETag/cache invalidation)."""
    version.content_updated_at = datetime.now(timezone.utc)


def to_utc_aware(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to a tz-aware UTC datetime for safe comparisons.

    Postgres TIMESTAMPTZ values already read back tz-aware; this also coerces any
    naive datetime (e.g. from a non-DB source) to UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
