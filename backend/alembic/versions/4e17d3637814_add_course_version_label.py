"""add course version label

Revision ID: 4e17d3637814
Revises: 378c62a02d4e
Create Date: 2026-07-09 08:48:36.416266

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4e17d3637814'
down_revision: Union[str, Sequence[str], None] = '378c62a02d4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('course_versions') as batch_op:
        batch_op.add_column(
            sa.Column('label', sa.String(length=200), nullable=False, server_default=''))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('course_versions') as batch_op:
        batch_op.drop_column('label')
