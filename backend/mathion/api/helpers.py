import os
import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.assets import sanitize_filename
from mathion.config import settings
from mathion.database import Base
from mathion.models import CourseVersion, Run, RunStudent

if TYPE_CHECKING:
    from mathion.models_auth import User

from mathion.api.text_utils import bump_content_updated_at, slugify, to_utc_aware
from mathion.api.lookups import INT4_MAX, get_newest_published_version, get_or_404, get_or_create_user
from mathion.api.authz import has_run_pinned_to_version, has_run_teacher_on_course, is_run_admin_or_teacher, require_course_admin, require_course_admin_for_run, require_run_admin_or_teacher
from mathion.api.roster_ops import STUDENT_ALREADY_ACTIVE_ERROR_CODE, enroll_user_in_run, find_student_active_conflicts, make_already_active_409_body, remove_run_student
from mathion.api.asset_render import render_with_assets, render_with_run_assets, sync_asset_references, sync_run_asset_references, sync_script_reference
from mathion.api.submission_files import build_feedback_filename, build_submission_filename, get_submitter_group, has_submissions, mini_project_visible_to_student, run_asset_storage_dir, submission_storage_dir
