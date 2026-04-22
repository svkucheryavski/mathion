from fastapi import HTTPException
from sqlalchemy.orm import Session

from mathion.database import Base


def get_or_404(db: Session, model: type[Base], id: int, detail: str | None = None):
    obj = db.get(model, id)
    if not obj:
        name = model.__name__
        raise HTTPException(status_code=404, detail=detail or f"{name} not found")
    return obj
