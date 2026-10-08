"""backfill empty version labels

The version label became mandatory (user, 2026-10-08): the API rejects an empty
label on create, duplicate and edit. Existing versions without one get
"Version <id>". Data only; no schema change.

Revision ID: b3c1d9e5a7f2
Revises: 67e8294b4267
Create Date: 2026-10-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b3c1d9e5a7f2'
down_revision: Union[str, Sequence[str], None] = '67e8294b4267'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Name every unlabelled version "Version <id>"."""
    op.execute("UPDATE course_versions SET label = 'Version ' || id WHERE btrim(label) = ''")


def downgrade() -> None:
    """No-op: the old labels were empty, and an empty label is still valid
    under the previous revision; the backfilled names are kept."""
