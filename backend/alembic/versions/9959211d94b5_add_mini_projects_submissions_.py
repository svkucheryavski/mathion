"""add mini projects submissions evaluations

Revision ID: 9959211d94b5
Revises: 4b1b93fe1c10
Create Date: 2026-04-28 13:31:57.346764

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9959211d94b5'
down_revision: Union[str, Sequence[str], None] = '4b1b93fe1c10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_disabled to existing groups table.
    # SQLite supports ALTER TABLE ADD COLUMN with NOT NULL DEFAULT for constants.
    op.add_column(
        "groups",
        sa.Column("is_disabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )

    # New table: mini_projects
    op.create_table(
        "mini_projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block_id", sa.Integer(), sa.ForeignKey("blocks.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assignment_md", sa.Text(), nullable=False),
        sa.Column("assignment_html", sa.Text(), nullable=False),
        sa.Column("soft_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hard_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resubmission_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("first_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.UniqueConstraint("run_id", "block_id", name="uq_mini_project_run_block"),
        sa.CheckConstraint(
            "soft_deadline IS NULL OR hard_deadline IS NULL OR soft_deadline <= hard_deadline",
            name="ck_mini_project_soft_le_hard",
        ),
        sa.CheckConstraint(
            "hard_deadline IS NULL OR resubmission_deadline IS NULL OR hard_deadline <= resubmission_deadline",
            name="ck_mini_project_hard_le_resubmission",
        ),
    )
    op.create_index(op.f("ix_mini_projects_run_id"), "mini_projects", ["run_id"])
    op.create_index(op.f("ix_mini_projects_block_id"), "mini_projects", ["block_id"])
    op.create_index("ix_mini_projects_run_published", "mini_projects", ["run_id", "is_published"])

    # New table: submissions
    op.create_table(
        "submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("mini_project_id", sa.Integer(), sa.ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("submission_number", sa.Integer(), nullable=False),
        sa.Column("submitted_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_resubmission", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.UniqueConstraint("mini_project_id", "group_id", "submission_number", name="uq_submission_number"),
        sa.CheckConstraint("submission_number >= 1", name="ck_submission_number_positive"),
        sa.CheckConstraint("file_size > 0", name="ck_submission_file_size_positive"),
    )
    op.create_index(op.f("ix_submissions_mini_project_id"), "submissions", ["mini_project_id"])
    op.create_index(op.f("ix_submissions_group_id"), "submissions", ["group_id"])
    op.create_index(
        "ix_submissions_latest",
        "submissions",
        ["mini_project_id", "group_id", "submission_number"],
    )

    # New table: evaluations
    op.create_table(
        "evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evaluated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("feedback_text", sa.Text(), nullable=True),
        sa.Column("feedback_file", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.CheckConstraint(
            "result IN ('rejected', 'major_revision', 'minor_revision', 'accepted')",
            name="ck_evaluation_result_enum",
        ),
        sa.CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 100)",
            name="ck_evaluation_score_range",
        ),
        sa.CheckConstraint(
            "result = 'accepted' OR feedback_file IS NOT NULL",
            name="ck_evaluation_feedback_file_required",
        ),
    )
    op.create_index(op.f("ix_evaluations_submission_id"), "evaluations", ["submission_id"], unique=True)

    # New table: run_assets
    op.create_table(
        "run_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text('(CURRENT_TIMESTAMP)')),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.UniqueConstraint("run_id", "filename", name="uq_run_asset_run_filename"),
    )
    op.create_index(op.f("ix_run_assets_run_id"), "run_assets", ["run_id"])

    # New table: run_asset_references
    op.create_table(
        "run_asset_references",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_asset_id", sa.Integer(), sa.ForeignKey("run_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mini_project_id", sa.Integer(), sa.ForeignKey("mini_projects.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index(op.f("ix_run_asset_references_run_asset_id"), "run_asset_references", ["run_asset_id"])
    op.create_index(op.f("ix_run_asset_references_mini_project_id"), "run_asset_references", ["mini_project_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_run_asset_references_mini_project_id"), table_name="run_asset_references")
    op.drop_index(op.f("ix_run_asset_references_run_asset_id"), table_name="run_asset_references")
    op.drop_table("run_asset_references")
    op.drop_index(op.f("ix_run_assets_run_id"), table_name="run_assets")
    op.drop_table("run_assets")
    op.drop_index(op.f("ix_evaluations_submission_id"), table_name="evaluations")
    op.drop_table("evaluations")
    op.drop_index("ix_submissions_latest", table_name="submissions")
    op.drop_index(op.f("ix_submissions_group_id"), table_name="submissions")
    op.drop_index(op.f("ix_submissions_mini_project_id"), table_name="submissions")
    op.drop_table("submissions")
    op.drop_index("ix_mini_projects_run_published", table_name="mini_projects")
    op.drop_index(op.f("ix_mini_projects_block_id"), table_name="mini_projects")
    op.drop_index(op.f("ix_mini_projects_run_id"), table_name="mini_projects")
    op.drop_table("mini_projects")
    op.drop_column("groups", "is_disabled")
