"""add_unique_student_enrollment

Revision ID: ccb0a42e6f15
Revises: ce0cfee6ac72
Create Date: 2026-04-25 17:18:45.956275

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ccb0a42e6f15'
down_revision: Union[str, Sequence[str], None] = 'ce0cfee6ac72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('student_enrollments') as batch_op:
        batch_op.create_unique_constraint('uq_student_enrollment', ['user_id', 'version_id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('student_enrollments') as batch_op:
        batch_op.drop_constraint('uq_student_enrollment', type_='unique')
