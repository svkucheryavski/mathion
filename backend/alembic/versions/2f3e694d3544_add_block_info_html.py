"""add block info_html

Revision ID: 2f3e694d3544
Revises: 3e7ba736bcd2
Create Date: 2026-05-03 12:39:42.042338

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f3e694d3544'
down_revision: Union[str, Sequence[str], None] = '3e7ba736bcd2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add Block.info_html with backfill from existing info markdown."""
    # Phase 1: add column as nullable so backfill can populate it row-by-row.
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.add_column(sa.Column('info_html', sa.Text(), nullable=True))

    # Phase 2: backfill — render existing info markdown to HTML.
    from mathion.markdown import render_markdown
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, info FROM blocks")).fetchall()
    for row in rows:
        html = render_markdown(row.info or "")
        conn.execute(
            sa.text("UPDATE blocks SET info_html = :h WHERE id = :i"),
            {"h": html, "i": row.id},
        )

    # Phase 3: tighten to NOT NULL with empty-string default.
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.alter_column('info_html', nullable=False, server_default='')


def downgrade() -> None:
    """Drop Block.info_html column."""
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.drop_column('info_html')
