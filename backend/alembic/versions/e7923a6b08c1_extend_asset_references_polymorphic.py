"""extend_asset_references_polymorphic

Revision ID: e7923a6b08c1
Revises: ccb0a42e6f15
Create Date: 2026-04-25 20:24:08.387525

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7923a6b08c1'
down_revision: Union[str, Sequence[str], None] = 'ccb0a42e6f15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('asset_references') as batch_op:
        batch_op.add_column(sa.Column('question_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('info_version_id', sa.Integer(), nullable=True))
        batch_op.alter_column('item_id', existing_type=sa.INTEGER(), nullable=True)
        batch_op.drop_constraint('uq_asset_reference', type_='unique')
        batch_op.create_index('ix_asset_references_info_version_id', ['info_version_id'], unique=False)
        batch_op.create_index('ix_asset_references_question_id', ['question_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_asset_references_question_id',
            'questions', ['question_id'], ['id'], ondelete='CASCADE',
        )
        batch_op.create_foreign_key(
            'fk_asset_references_info_version_id',
            'course_versions', ['info_version_id'], ['id'], ondelete='CASCADE',
        )


def downgrade() -> None:
    with op.batch_alter_table('asset_references') as batch_op:
        batch_op.drop_constraint('fk_asset_references_info_version_id', type_='foreignkey')
        batch_op.drop_constraint('fk_asset_references_question_id', type_='foreignkey')
        batch_op.drop_index('ix_asset_references_question_id')
        batch_op.drop_index('ix_asset_references_info_version_id')
        batch_op.create_unique_constraint('uq_asset_reference', ['asset_id', 'item_id'])
        batch_op.alter_column('item_id', existing_type=sa.INTEGER(), nullable=False)
        batch_op.drop_column('info_version_id')
        batch_op.drop_column('question_id')
