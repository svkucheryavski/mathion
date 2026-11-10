"""The superuser panel's Set up wizard (superuser Set up spec D13).

The read sits behind the panel token; the wizard's writes also need the CSRF
header. A write after the wizard is over answers 200 with the state, never
404 or 409 (D5a): the panel's 404 means only "link expired"."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from mathion import setup_state
from mathion.api.superuser import require_superuser_panel, require_superuser_panel_write
from mathion.database import get_db
from mathion.models_auth import User
from mathion.schemas import PanelSetup, SetupStepIn

router = APIRouter(tags=["superuser"])

_BASE = "/api/superuser/{token}/setup"
_BAD_STEP = "The step must be from 1 to 4."


def _step(data: SetupStepIn) -> int:
    # A whole number only: bool is an int in Python, so the type is compared.
    if type(data.step) is not int or not 1 <= data.step <= 4:
        raise HTTPException(status_code=422, detail=_BAD_STEP)
    return data.step


@router.get(_BASE, response_model=PanelSetup)
def get_setup(_user: User = Depends(require_superuser_panel), db: Session = Depends(get_db)):
    return setup_state.read(db)


@router.post(f"{_BASE}/go", response_model=PanelSetup)
def go(data: SetupStepIn, _user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    return setup_state.go_to(db, _step(data))


@router.post(f"{_BASE}/skip", response_model=PanelSetup)
def skip(data: SetupStepIn, _user: User = Depends(require_superuser_panel_write),
         db: Session = Depends(get_db)):
    return setup_state.skip(db, _step(data))


@router.post(f"{_BASE}/saved", response_model=PanelSetup)
def saved(data: SetupStepIn, _user: User = Depends(require_superuser_panel_write),
          db: Session = Depends(get_db)):
    return setup_state.saved(db, _step(data))


@router.post(f"{_BASE}/keep-sign-in", response_model=PanelSetup)
def keep_sign_in(_user: User = Depends(require_superuser_panel_write), db: Session = Depends(get_db)):
    return setup_state.keep_sign_in(db)
