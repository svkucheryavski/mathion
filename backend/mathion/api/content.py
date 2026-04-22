from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from mathion.database import get_db
from mathion.models import Block, CourseVersion, Item, Question, Sequence

router = APIRouter(tags=["content"])


@router.get("/api/versions/{version_id}/content")
def get_content_json(version_id: int, db: Session = Depends(get_db)):
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
