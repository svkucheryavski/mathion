"""timezone-aware timestamps and numeric precision

Revision ID: d1b52f02e8ba
Revises: 10fce4a046d9
Create Date: 2026-04-22 12:19:29.521429

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1b52f02e8ba'
down_revision: Union[str, Sequence[str], None] = '10fce4a046d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Use batch mode so the migration works on SQLite (which lacks ALTER COLUMN TYPE).
    with op.batch_alter_table('questions') as batch_op:
        batch_op.alter_column('correct_numeric',
                   existing_type=sa.FLOAT(),
                   type_=sa.Numeric(precision=20, scale=10),
                   existing_nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('questions') as batch_op:
        batch_op.alter_column('correct_numeric',
                   existing_type=sa.Numeric(precision=20, scale=10),
                   type_=sa.FLOAT(),
                   existing_nullable=True)
