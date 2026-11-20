"""answer choices gain text_html

Math plan Task 5: an answer choice is shown from text_html, which a save,
publish or clone renders with math. Existing choices get the escaped text, so
they show exactly as before until they are saved, published or cloned.

Revision ID: 308aba5de73e
Revises: d9a4c2e7f1b3
Create Date: 2026-11-20 12:00:00.000000

"""
import html
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = '308aba5de73e'
down_revision: Union[str, Sequence[str], None] = 'd9a4c2e7f1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add text_html and fill it with the escaped text, row by row."""
    op.add_column("answer_options", sa.Column("text_html", sa.Text(), nullable=False, server_default=""))
    conn = op.get_bind()
    for row_id, value in conn.execute(sa.text("SELECT id, text FROM answer_options")).all():
        conn.execute(sa.text("UPDATE answer_options SET text_html = :v WHERE id = :id"),
                     {"v": html.escape(value or "", quote=False), "id": row_id})
    op.alter_column("answer_options", "text_html", server_default=None)


def downgrade() -> None:
    """Drop the column."""
    op.drop_column("answer_options", "text_html")
