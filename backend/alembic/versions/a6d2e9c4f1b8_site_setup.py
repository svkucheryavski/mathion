"""site_setup: the panel's Set up wizard

D10 (superuser Set up spec): a site with no course gets the wizard turned on
at step 1; a site with a course gets no row, which means the wizard is over,
and keeps its name and sign-in values (D7, D9). A site already renamed keeps
its name too. D6's send record starts empty.

Revision ID: a6d2e9c4f1b8
Revises: f3a9c1e7b2d4
Create Date: 2026-11-08 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a6d2e9c4f1b8'
down_revision: Union[str, Sequence[str], None] = 'f3a9c1e7b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create site_setup, add the kept marks and the send record, and decide
    whether the wizard runs."""
    op.create_table(
        'site_setup',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('wizard_on', sa.Boolean(), nullable=False),
        sa.Column('step', sa.Integer(), nullable=False),
        sa.Column('passed_mask', sa.Integer(), nullable=False),
        sa.CheckConstraint('id = 1', name='ck_site_setup_one_row'),
        sa.CheckConstraint('step BETWEEN 1 AND 4', name='ck_site_setup_step'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.add_column('site_settings', sa.Column('site_name_kept', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('site_settings', sa.Column('sign_in_kept', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('site_settings', sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "INSERT INTO site_setup (id, wizard_on, step, passed_mask)"
        " SELECT 1, true, 1, 0 WHERE NOT EXISTS (SELECT 1 FROM courses)"
    )
    op.execute(
        "UPDATE site_settings SET site_name_kept = true, sign_in_kept = true"
        " WHERE EXISTS (SELECT 1 FROM courses)"
    )
    op.execute(
        "UPDATE site_settings SET site_name_kept = true"
        " WHERE EXISTS (SELECT 1 FROM site_branding WHERE site_name <> 'Mathion')"
    )


def downgrade() -> None:
    op.drop_column('site_settings', 'last_sent_at')
    op.drop_column('site_settings', 'sign_in_kept')
    op.drop_column('site_settings', 'site_name_kept')
    op.drop_table('site_setup')
