"""add superuser panel token

Revision ID: 0294936c4fc2
Revises: 4e17d3637814
Create Date: 2026-07-12 14:37:49.998934

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0294936c4fc2'
down_revision: Union[str, Sequence[str], None] = '4e17d3637814'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'superuser_panel_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('last_active_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_superuser_panel_tokens_token_hash'), 'superuser_panel_tokens', ['token_hash'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_superuser_panel_tokens_token_hash'), table_name='superuser_panel_tokens')
    op.drop_table('superuser_panel_tokens')
