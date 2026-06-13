"""notification_dispatcher_columns

Revision ID: 378c62a02d4e
Revises: 2f3e694d3544
Create Date: 2026-06-13 16:40:13.555181

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '378c62a02d4e'
down_revision: Union[str, Sequence[str], None] = '2f3e694d3544'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('notification_log') as batch_op:
        batch_op.add_column(
            sa.Column('retry_count', sa.Integer, nullable=False, server_default='0'))
        batch_op.add_column(
            sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column('error', sa.String(length=500), nullable=True))

    op.execute("UPDATE notification_log SET sent_at = CURRENT_TIMESTAMP "
               "WHERE sent_at IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('notification_log') as batch_op:
        batch_op.drop_column('error')
        batch_op.drop_column('next_attempt_at')
        batch_op.drop_column('retry_count')
