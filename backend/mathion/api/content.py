from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from mathion.database import get_db
from mathion.dependencies import get_current_user
from mathion.models import Block, CourseAdmin, CourseVersion, Item, Question, Sequence
from mathion.models_auth import StudentEnrollment, User

router = APIRouter(tags=["content"])


@router.get("/api/versions/{version_id}/content")
def get_content_json(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # C5: eager-load version.course using select() style
    version = db.execute(
        select(CourseVersion)
        .options(joinedload(CourseVersion.course))
        .where(CourseVersion.id == version_id)
    ).scalar_one_or_none()

    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if version.is_disabled:
        raise HTTPException(status_code=403, detail="This version is disabled")

    if version.state not in ("published", "archived"):
        raise HTTPException(status_code=403, detail="This version is not published")

    # Check access: superuser OR course admin OR enrolled student with active enrollment
    if not user.is_superuser:
        is_admin = db.execute(
            select(CourseAdmin).where(
                CourseAdmin.course_id == version.course_id,
                CourseAdmin.user_id == user.id,
            )
        ).scalar_one_or_none()

        if not is_admin:
            # Allow any enrollment (active or inactive) on this specific version.
            # Inactive enrollments preserve read access per spec.
            is_enrolled = db.execute(
                select(StudentEnrollment).where(
                    StudentEnrollment.version_id == version_id,
                    StudentEnrollment.user_id == user.id,
                )
            ).scalar_one_or_none()

            if not is_enrolled:
                raise HTTPException(status_code=403, detail="Access denied")

    # Eager load the full tree using select() style
    blocks = db.execute(
        select(Block)
        .where(Block.version_id == version_id)
        .options(
            joinedload(Block.sequences)
            .joinedload(Sequence.items)
            .joinedload(Item.questions)
            .joinedload(Question.options)
        )
        .order_by(Block.order)
    ).unique().scalars().all()

    return {
        "course": {
            "name": version.course.name,
            "slug": version.course.slug,
        },
        "version": {
            "id": version.id,
            "state": version.state,
            "info_html": version.info_html,
            "max_quiz_attempts": version.max_quiz_attempts,
        },
        "blocks": [
            {
                "id": block.id,
                "title": block.title,
                "slug": block.slug,
                "order": block.order,
                "info": block.info,
                "info_html": block.info_html,
                "sequences": sorted(
                    [
                        {
                            "id": seq.id,
                            "title": seq.title,
                            "slug": seq.slug,
                            "order": seq.order,
                            "items": sorted(
                                [_serialize_item(item) for item in seq.items],
                                key=lambda x: x["order"],
                            ),
                        }
                        for seq in block.sequences
                    ],
                    key=lambda x: x["order"],
                ),
            }
            for block in blocks
        ],
    }


@router.get("/api/versions/{version_id}/admin-tree")
def get_admin_tree(version_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from mathion.api.helpers import require_course_admin
    version = db.execute(
        select(CourseVersion)
        .options(joinedload(CourseVersion.course))
        .where(CourseVersion.id == version_id)
    ).scalar_one_or_none()
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    require_course_admin(db, user, version.course_id)

    blocks = db.execute(
        select(Block)
        .where(Block.version_id == version_id)
        .options(
            joinedload(Block.sequences)
            .joinedload(Sequence.items)
            .joinedload(Item.questions)
        )
        .order_by(Block.order)
    ).unique().scalars().all()

    return {
        "course": {"id": version.course.id, "name": version.course.name, "slug": version.course.slug},
        "version": {
            "id": version.id,
            "course_id": version.course_id,
            "state": version.state,
            "is_disabled": version.is_disabled,
            "info_md": version.info_md,
            "info_html": version.info_html,
            "max_quiz_attempts": version.max_quiz_attempts,
            "created_at": version.created_at.isoformat(),
            "published_at": version.published_at.isoformat() if version.published_at else None,
            "archived_at": version.archived_at.isoformat() if version.archived_at else None,
            "content_updated_at": version.content_updated_at.isoformat(),
        },
        "blocks": [
            {
                "id": b.id,
                "version_id": b.version_id,
                "title": b.title,
                "slug": b.slug,
                "order": b.order,
                "info": b.info,
                "info_html": b.info_html,
                "sequences": sorted(
                    [
                        {
                            "id": s.id,
                            "block_id": s.block_id,
                            "title": s.title,
                            "slug": s.slug,
                            "order": s.order,
                            "items": sorted(
                                [
                                    {
                                        "id": it.id,
                                        "sequence_id": it.sequence_id,
                                        "title": it.title,
                                        "slug": it.slug,
                                        "order": it.order,
                                        "type": it.type,
                                        "content_md": it.content_md,
                                        "content_html": it.content_html,
                                        "video_url": it.video_url,
                                        "script_url": it.script_url,
                                        "questions_count": len(it.questions) if it.questions is not None else 0,
                                    }
                                    for it in s.items
                                ],
                                key=lambda x: x["order"],
                            ),
                        }
                        for s in b.sequences
                    ],
                    key=lambda x: x["order"],
                ),
            }
            for b in blocks
        ],
    }


def _serialize_item(item):
    result = {
        "id": item.id,
        "title": item.title,
        "slug": item.slug,
        "order": item.order,
        "type": item.type,
    }

    if item.type == "static_page":
        result["content_html"] = item.content_html or ""
    elif item.type == "video":
        result["video_url"] = item.video_url
    elif item.type == "interactive_app":
        result["script_url"] = item.script_url
    elif item.type == "quiz":
        result["questions"] = [
            {
                "id": q.id,
                "text_html": q.text_html,
                "type": q.type,
                "order": q.order,
                "options": [
                    {"id": o.id, "text": o.text, "order": o.order}
                    for o in sorted(q.options, key=lambda o: o.order)
                ]
                if q.type in ("single_choice", "multiple_choice")
                else [],
            }
            for q in sorted(item.questions, key=lambda q: q.order)
        ]

    return result
