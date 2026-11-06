"""site_branding: the panel's Branding

D12 (superuser Branding spec): the site name, the image sizes and hashes and
the colour changes live in one row; the logo's and the icon's bytes live in
their own table, so reading the row never loads them. No row means the
defaults, so nothing is copied.

Revision ID: f3a9c1e7b2d4
Revises: e8c4f2a6b1d7
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f3a9c1e7b2d4'
down_revision: Union[str, Sequence[str], None] = 'e8c4f2a6b1d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create site_branding and site_branding_images."""
    op.create_table(
        'site_branding',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('site_name', sa.String(length=60), nullable=False),
        sa.Column('logo_width', sa.Integer(), nullable=True),
        sa.Column('logo_height', sa.Integer(), nullable=True),
        sa.Column('logo_hash', sa.String(length=16), nullable=True),
        sa.Column('icon_width', sa.Integer(), nullable=True),
        sa.Column('icon_height', sa.Integer(), nullable=True),
        sa.Column('icon_hash', sa.String(length=16), nullable=True),
        sa.Column('theme_changes', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint('id = 1', name='ck_site_branding_one_row'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'site_branding_images',
        sa.Column('kind', sa.String(length=4), nullable=False),
        sa.Column('data', sa.LargeBinary(), nullable=False),
        sa.CheckConstraint("kind IN ('logo', 'icon')", name='ck_site_branding_images_kind'),
        sa.PrimaryKeyConstraint('kind'),
    )


def downgrade() -> None:
    op.drop_table('site_branding_images')
    op.drop_table('site_branding')
