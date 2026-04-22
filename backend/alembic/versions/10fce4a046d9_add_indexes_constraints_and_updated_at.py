"""add indexes constraints and updated_at

Revision ID: 10fce4a046d9
Revises: 7d74a2f89160
Create Date: 2026-04-21 10:11:28.765584

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '10fce4a046d9'
down_revision: Union[str, Sequence[str], None] = '7d74a2f89160'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # answer_options: add updated_at and index on question_id
    with op.batch_alter_table('answer_options') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False))
        batch_op.create_index(op.f('ix_answer_options_question_id'), ['question_id'], unique=False)

    # blocks: add updated_at, index on version_id, unique constraint on (version_id, slug)
    with op.batch_alter_table('blocks') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False))
        batch_op.create_index(op.f('ix_blocks_version_id'), ['version_id'], unique=False)
        batch_op.create_unique_constraint('uq_block_version_slug', ['version_id', 'slug'])

    # course_admins: index on course_id, unique constraint on (course_id, user_id)
    with op.batch_alter_table('course_admins') as batch_op:
        batch_op.create_index(op.f('ix_course_admins_course_id'), ['course_id'], unique=False)
        batch_op.create_unique_constraint('uq_course_admin', ['course_id', 'user_id'])

    # course_versions: add updated_at, index on course_id
    with op.batch_alter_table('course_versions') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False))
        batch_op.create_index(op.f('ix_course_versions_course_id'), ['course_id'], unique=False)

    # items: add updated_at, index on sequence_id, unique constraint on (sequence_id, slug)
    with op.batch_alter_table('items') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False))
        batch_op.create_index(op.f('ix_items_sequence_id'), ['sequence_id'], unique=False)
        batch_op.create_unique_constraint('uq_item_sequence_slug', ['sequence_id', 'slug'])

    # questions: add updated_at, index on item_id
    with op.batch_alter_table('questions') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False))
        batch_op.create_index(op.f('ix_questions_item_id'), ['item_id'], unique=False)

    # sequences: add updated_at, index on block_id, unique constraint on (block_id, slug)
    with op.batch_alter_table('sequences') as batch_op:
        batch_op.add_column(sa.Column('updated_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False))
        batch_op.create_index(op.f('ix_sequences_block_id'), ['block_id'], unique=False)
        batch_op.create_unique_constraint('uq_sequence_block_slug', ['block_id', 'slug'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sequences') as batch_op:
        batch_op.drop_constraint('uq_sequence_block_slug', type_='unique')
        batch_op.drop_index(op.f('ix_sequences_block_id'))
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('questions') as batch_op:
        batch_op.drop_index(op.f('ix_questions_item_id'))
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('items') as batch_op:
        batch_op.drop_constraint('uq_item_sequence_slug', type_='unique')
        batch_op.drop_index(op.f('ix_items_sequence_id'))
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('course_versions') as batch_op:
        batch_op.drop_index(op.f('ix_course_versions_course_id'))
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('course_admins') as batch_op:
        batch_op.drop_constraint('uq_course_admin', type_='unique')
        batch_op.drop_index(op.f('ix_course_admins_course_id'))

    with op.batch_alter_table('blocks') as batch_op:
        batch_op.drop_constraint('uq_block_version_slug', type_='unique')
        batch_op.drop_index(op.f('ix_blocks_version_id'))
        batch_op.drop_column('updated_at')

    with op.batch_alter_table('answer_options') as batch_op:
        batch_op.drop_index(op.f('ix_answer_options_question_id'))
        batch_op.drop_column('updated_at')
