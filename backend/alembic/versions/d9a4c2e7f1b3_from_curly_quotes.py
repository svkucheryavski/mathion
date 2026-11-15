"""straighten a curly pair around the saved From name

Settings D7b rev 13 (the user's call, 2026-11-15): a curly pair that wraps the
whole name before "<" counts as straight quotes, and a save stores it
straight. A From saved before that keeps its curly pair until this runs.
Data only; no schema change.

Revision ID: d9a4c2e7f1b3
Revises: a6d2e9c4f1b8
Create Date: 2026-11-15 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd9a4c2e7f1b3'
down_revision: Union[str, Sequence[str], None] = 'a6d2e9c4f1b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# A frozen copy of schemas.EmailTestIn._straight_quotes as of rev 13.
_PAIRS = {("“", "”"), ("„", "“"), ("„", "”"), ("«", "»"),
          ("»", "«"), ("”", "”"), ("»", "»")}
_STOPS = '"\\“”„«»'


def _straight(v: str) -> str:
    name, bracket, rest = v.partition("<")
    inner = name.rstrip()
    if (bracket and len(inner) > 2 and (inner[0], inner[-1]) in _PAIRS
            and not any(c in _STOPS for c in inner[1:-1])):
        return f'"{inner[1:-1]}"{name[len(inner):]}<{rest}'
    return v


def upgrade() -> None:
    """Store a curly-wrapped From name with straight quotes, as a save would."""
    conn = op.get_bind()
    for row_id, value in conn.execute(sa.text("SELECT id, email_from FROM site_settings")).all():
        straight = _straight(value or "")
        if straight != (value or ""):
            conn.execute(sa.text("UPDATE site_settings SET email_from = :v WHERE id = :id"),
                         {"v": straight, "id": row_id})


def downgrade() -> None:
    """No-op: straight quotes are valid under the previous revision too."""
