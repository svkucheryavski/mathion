from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Course, CourseAdmin, CourseVersion, Item, Sequence
from mathion.models_auth import StudentEnrollment, User, UserItemState
from mathion.schemas import (
    CourseResponse,
    ItemStateResponse,
    MyCourseResponse,
    MyVersionResponse,
    StateJsonResponse,
    TrackItemRequest,
    TrackItemResponse,
)

router = APIRouter(tags=["student"])


def _check_version_access(db: Session, user: User, version_id: int) -> CourseVersion:
    """Verify user has access to this version (enrolled or admin or superuser).

    Superusers and course admins can access disabled versions (needed for editing/debugging).
    Students are blocked from disabled versions.
    """
    version = get_or_404(db, CourseVersion, version_id)
    if user.is_superuser:
        return version
    # Check course admin — admins can access disabled versions
    is_admin = db.execute(
        select(CourseAdmin).where(CourseAdmin.course_id == version.course_id, CourseAdmin.user_id == user.id)
    ).scalar_one_or_none()
    if is_admin:
        return version
    # Students are blocked from disabled versions
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    # Check enrollment (active or inactive)
    is_enrolled = db.execute(
        select(StudentEnrollment).where(
            StudentEnrollment.version_id == version_id,
            StudentEnrollment.user_id == user.id,
        )
    ).scalar_one_or_none()
    if not is_enrolled:
        raise HTTPException(status_code=403, detail="Access denied")
    return version


@router.get("/api/versions/{version_id}/state", response_model=StateJsonResponse)
def get_state_json(version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    version = _check_version_access(db, user, version_id)

    # Get all item IDs for this version
    item_ids = db.execute(
        select(Item.id)
        .join(Sequence, Sequence.id == Item.sequence_id)
        .join(Block, Block.id == Sequence.block_id)
        .where(Block.version_id == version_id)
    ).scalars().all()

    # Get user states for these items
    states = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id.in_(item_ids),
        )
    ).scalars().all()

    items_dict = {}
    for s in states:
        last_score = None
        if s.last_score_correct is not None and s.last_score_total is not None:
            last_score = {"correct": s.last_score_correct, "total": s.last_score_total}

        items_dict[str(s.item_id)] = ItemStateResponse(
            is_covered=s.is_covered,
            time_spent=s.time_spent,
            last_visited_at=s.last_visited_at,
            attempt_count=s.attempt_count,
            max_attempts=version.max_quiz_attempts,
            last_score=last_score,
            last_answers=s.last_answers,
        )

    return StateJsonResponse(
        version_id=version_id,
        current_item_id=None,
        items=items_dict,
    )


@router.post("/api/items/{item_id}/track", response_model=TrackItemResponse)
def track_item(item_id: int, data: TrackItemRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = get_or_404(db, Item, item_id)

    # Verify user has access to this item's version
    seq = get_or_404(db, Sequence, item.sequence_id, detail="Item not found")
    block = get_or_404(db, Block, seq.block_id, detail="Item not found")
    _check_version_access(db, user, block.version_id)

    # Get or create state — handle race condition on concurrent insert
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state:
        state = UserItemState(user_id=user.id, item_id=item_id, is_covered=False, time_spent=0)
        db.add(state)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            state = db.execute(
                select(UserItemState).where(
                    UserItemState.user_id == user.id,
                    UserItemState.item_id == item_id,
                )
            ).scalar_one()

    state.time_spent += data.time_spent
    state.last_visited_at = datetime.now(timezone.utc)
    if data.is_covered is True:
        state.is_covered = True

    db.commit()
    db.refresh(state)

    return TrackItemResponse(
        item_id=state.item_id,
        is_covered=state.is_covered,
        time_spent=state.time_spent,
        last_visited_at=state.last_visited_at,
    )


@router.get("/api/my-courses", response_model=list[MyCourseResponse])
def my_courses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_superuser:
        admin_course_ids: set[int] = set(db.scalars(select(Course.id)).all())
    else:
        admin_course_ids = set(db.scalars(
            select(CourseAdmin.course_id).where(CourseAdmin.user_id == user.id)
        ).all())

    enrollments = db.execute(
        select(StudentEnrollment)
        .where(StudentEnrollment.user_id == user.id)
        .order_by(StudentEnrollment.created_at.desc())
    ).scalars().all()

    rows_by_course: dict[int, MyCourseResponse] = {}

    for enrollment in enrollments:
        version = db.get(CourseVersion, enrollment.version_id)
        if not version or version.is_disabled:
            continue
        if version.course_id in rows_by_course:
            continue
        course = db.get(Course, version.course_id)
        if not course:
            continue
        total_items = db.scalar(
            select(func.count())
            .select_from(Item)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(Block.version_id == version.id)
        ) or 0
        covered_items = db.scalar(
            select(func.count())
            .select_from(UserItemState)
            .join(Item, Item.id == UserItemState.item_id)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(
                Block.version_id == version.id,
                UserItemState.user_id == user.id,
                UserItemState.is_covered == True,  # noqa: E712
            )
        ) or 0
        is_admin = version.course_id in admin_course_ids
        rows_by_course[version.course_id] = MyCourseResponse(
            course=CourseResponse.model_validate(course).model_copy(update={"is_admin": is_admin}),
            version_id=version.id,
            version_state=version.state,
            total_items=total_items,
            covered_items=covered_items,
            is_active=enrollment.is_active,
            is_admin=is_admin,
        )

    for cid in admin_course_ids:
        if cid in rows_by_course:
            continue
        course = db.get(Course, cid)
        if not course:
            continue
        rows_by_course[cid] = MyCourseResponse(
            course=CourseResponse.model_validate(course).model_copy(update={"is_admin": True}),
            is_admin=True,
        )

    return list(rows_by_course.values())


@router.get("/api/courses/{course_slug}/my-version", response_model=MyVersionResponse)
def resolve_my_version(course_slug: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Resolve a course slug to the user's enrolled version."""
    course = db.execute(select(Course).where(Course.slug == course_slug)).scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Not found")

    # Find user's most recent enrollment on a non-disabled version of this course
    enrollment = db.execute(
        select(StudentEnrollment)
        .join(CourseVersion, CourseVersion.id == StudentEnrollment.version_id)
        .where(
            CourseVersion.course_id == course.id,
            CourseVersion.is_disabled == False,
            StudentEnrollment.user_id == user.id,
        )
        .order_by(StudentEnrollment.is_active.desc(), StudentEnrollment.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if not enrollment:
        raise HTTPException(status_code=404, detail="Not found")

    return MyVersionResponse(
        course_slug=course_slug,
        course_id=course.id,
        version_id=enrollment.version_id,
        is_active=enrollment.is_active,
    )
