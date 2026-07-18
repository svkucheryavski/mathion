"""Ordering must be deterministic on Postgres.

Postgres does not guarantee row order for a LIMIT/OFFSET query without an
ORDER BY, and gives no stable order among rows that tie on the sort key. The
§7a sweep adds a unique `.id` tie-breaker to every user-facing / decision-driving
ORDER BY (and an ORDER BY to the previously-unordered course pagination). This
test pins the course-pagination contract: a full paginated walk reproduces the
complete, non-overlapping, ascending-by-id list.

(On a small static table Postgres often returns heap = insertion = id order, so
this can pass even without the fix; its value is as a regression guard for the
pagination contract the ORDER BY Course.id guarantees under real conditions.)
"""
from sqlalchemy import select

from mathion.models import Course


def test_course_list_pagination_is_deterministic_and_complete(admin_client, db):
    # Create several courses in one transaction (ids ascending, no natural order).
    for i in range(7):
        db.add(Course(slug=f"c{i}", name=f"Course {i}", description=""))
    db.commit()

    all_ids = [c.id for c in db.execute(select(Course).order_by(Course.id)).scalars()]
    assert len(all_ids) >= 7

    collected: list[int] = []
    for offset in range(0, len(all_ids), 2):
        page = admin_client.get(f"/api/courses?limit=2&offset={offset}").json()
        collected.extend(c["id"] for c in page)

    # Every course appears exactly once, in ascending id order, across all pages.
    assert collected == all_ids
