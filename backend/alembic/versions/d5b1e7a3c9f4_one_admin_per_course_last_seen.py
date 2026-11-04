"""one admin per course; users.last_seen_at

D6 (user, 2026-11-03): a course has exactly one admin, enforced in the
database. Existing courses keep their earliest admin row (lowest id); every
other row is removed, one printed line each. The data step runs before the
constraint, so this never fails on existing data (`mathion update` rolls back
on any migration failure).

D22: "Last active" in the superuser panel needs a value that survives logout,
and sessions are deleted at logout. `users.last_seen_at` is backfilled from
the later of each user's latest session and their NEWEST sign-in PIN when that
PIN is used (login_pins are never pruned, so it still dates a sign-in after
logout; user, 2026-11-03). Only the newest PIN counts: request_pin marks every
older unused PIN used when it issues a new one, so only verify_pin can leave
the newest PIN used. The PIN's time is its request time, up to the PIN
lifetime before the sign-in.

Revision ID: d5b1e7a3c9f4
Revises: c7e2a4f9d1b3
Create Date: 2026-11-03 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd5b1e7a3c9f4'
down_revision: Union[str, Sequence[str], None] = 'c7e2a4f9d1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Keep each course's earliest admin, make course_id unique, add last_seen_at."""
    conn = op.get_bind()
    extra = conn.execute(sa.text(
        "SELECT id, course_id, user_id FROM course_admins ca "
        "WHERE ca.id > (SELECT min(id) FROM course_admins WHERE course_id = ca.course_id) "
        "ORDER BY id"
    )).all()
    for row_id, course_id, user_id in extra:
        print(f"one-admin-per-course: removed course_admins id={row_id} (course {course_id}, user {user_id})")
    if extra:
        conn.execute(sa.text("DELETE FROM course_admins WHERE id = ANY(:ids)"),
                     {"ids": [r[0] for r in extra]})

    op.drop_constraint('uq_course_admin', 'course_admins', type_='unique')
    op.drop_index('ix_course_admins_course_id', table_name='course_admins')
    op.create_unique_constraint('uq_course_admins_course_id', 'course_admins', ['course_id'])

    op.add_column('users', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))
    # GREATEST ignores NULLs in Postgres, so either source alone is enough.
    op.execute(
        "UPDATE users u SET last_seen_at = GREATEST(s.m, p.m) "
        "FROM users x "
        "LEFT JOIN (SELECT user_id, max(last_active_at) AS m FROM sessions GROUP BY user_id) s "
        "  ON s.user_id = x.id "
        "LEFT JOIN (SELECT DISTINCT ON (user_id) user_id, "
        "                  CASE WHEN is_used THEN created_at END AS m "
        "           FROM login_pins ORDER BY user_id, created_at DESC, id DESC) p "
        "  ON p.user_id = x.id "
        "WHERE x.id = u.id AND (s.m IS NOT NULL OR p.m IS NOT NULL)"
    )


def downgrade() -> None:
    """Restore the old shape. Admin rows removed by upgrade are not restored."""
    op.drop_column('users', 'last_seen_at')
    op.drop_constraint('uq_course_admins_course_id', 'course_admins', type_='unique')
    op.create_index('ix_course_admins_course_id', 'course_admins', ['course_id'], unique=False)
    op.create_unique_constraint('uq_course_admin', 'course_admins', ['course_id', 'user_id'])
