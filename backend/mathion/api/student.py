from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from mathion.api.helpers import get_or_404
from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, Course, CourseAdmin, CourseVersion, Item, Sequence
from mathion.models_auth import StudentEnrollment, User, UserItemState
from mathion.schemas import CourseResponse, ItemStateResponse, MyCourseResponse, StateJsonResponse, TrackItemRequest

router = APIRouter(tags=["student"])


def _check_version_access(db: Session, user: User, version_id: int) -> CourseVersion:
    """Verify user has access to this version (enrolled or admin or superuser)."""
    version = get_or_404(db, CourseVersion, version_id)
    if version.is_disabled:
        raise HTTPException(status_code=403, detail="Version is disabled")
    if user.is_superuser:
        return version
    # Check course admin
    is_admin = db.execute(
        select(CourseAdmin).where(CourseAdmin.course_id == version.course_id, CourseAdmin.user_id == user.id)
    ).scalar_one_or_none()
    if is_admin:
        return version
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


@router.post("/api/items/{item_id}/track")
def track_item(item_id: int, data: TrackItemRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = get_or_404(db, Item, item_id)

    # Verify user has access to this item's version
    seq = db.get(Sequence, item.sequence_id)
    block = db.get(Block, seq.block_id)
    _check_version_access(db, user, block.version_id)

    # Get or create state
    state = db.execute(
        select(UserItemState).where(
            UserItemState.user_id == user.id,
            UserItemState.item_id == item_id,
        )
    ).scalar_one_or_none()

    if not state:
        state = UserItemState(user_id=user.id, item_id=item_id, is_covered=False, time_spent=0)
        db.add(state)

    state.time_spent += data.time_spent
    state.last_visited_at = datetime.now(timezone.utc)
    if data.is_covered is True:
        state.is_covered = True

    db.commit()
    db.refresh(state)

    return {
        "item_id": state.item_id,
        "is_covered": state.is_covered,
        "time_spent": state.time_spent,
        "last_visited_at": state.last_visited_at.isoformat() if state.last_visited_at else None,
    }


@router.get("/api/my-courses", response_model=list[MyCourseResponse])
def my_courses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    enrollments = db.execute(
        select(StudentEnrollment)
        .where(StudentEnrollment.user_id == user.id)
        .order_by(StudentEnrollment.created_at.desc())
    ).scalars().all()

    results = []
    seen_courses = set()

    for enrollment in enrollments:
        version = db.get(CourseVersion, enrollment.version_id)
        if not version or version.is_disabled:
            continue

        # Only show the most recent enrollment per course
        if version.course_id in seen_courses:
            continue
        seen_courses.add(version.course_id)

        course = db.get(Course, version.course_id)

        # Count total items in this version
        total_items = db.scalar(
            select(func.count())
            .select_from(Item)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(Block.version_id == version.id)
        )

        # Count covered items for this user
        covered_items = db.scalar(
            select(func.count())
            .select_from(UserItemState)
            .join(Item, Item.id == UserItemState.item_id)
            .join(Sequence, Sequence.id == Item.sequence_id)
            .join(Block, Block.id == Sequence.block_id)
            .where(
                Block.version_id == version.id,
                UserItemState.user_id == user.id,
                UserItemState.is_covered == True,
            )
        )

        results.append(MyCourseResponse(
            course=CourseResponse.model_validate(course),
            version_id=version.id,
            version_state=version.state,
            total_items=total_items or 0,
            covered_items=covered_items or 0,
            is_active=enrollment.is_active,
        ))

    return results
