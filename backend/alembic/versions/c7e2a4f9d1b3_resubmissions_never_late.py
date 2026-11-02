"""resubmissions are never late

D81 (user, 2026-10-30): a resubmission is bound only by the resubmission
deadline, past which the server refuses it, so it is never late. The old rule
compared every submission with the soft deadline; clear the mark it left on
existing resubmissions. Data only; no schema change.

Revision ID: c7e2a4f9d1b3
Revises: b3c1d9e5a7f2
Create Date: 2026-10-30 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c7e2a4f9d1b3'
down_revision: Union[str, Sequence[str], None] = 'b3c1d9e5a7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Clear the late mark on every resubmission."""
    op.execute("UPDATE submissions SET is_late = false WHERE is_resubmission AND is_late")


def downgrade() -> None:
    """No-op: the old marks are not kept, and a resubmission that is not late
    is still valid under the previous revision."""
