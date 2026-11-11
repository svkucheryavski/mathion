"""What the panel says about people and email, shared by the Courses page
and Set up (superuser Users/Courses D5a, Set up D8, D13). A module of its
own, so neither page imports the other."""
from sqlalchemy.orm import Session

from mathion.config import settings
from mathion.models_auth import User
from mathion.notifications.mailer import DEV_MODES
from mathion.schemas import PanelAdmin
from mathion.site_settings import SiteSettingsView, load as load_site


def email_set_up_in(view: SiteSettingsView) -> bool:
    # D5a: "set up" means the queue has a mailer: a developer outbox (D2c; the
    # `memory` test sink counts on purpose) or the panel's email switch on
    # (superuser Settings D10b). Not send_pin_enabled: that is also true in
    # debug with email off.
    return settings.email_mode in DEV_MODES or view.email_on


def email_is_set_up(db: Session) -> bool:
    return email_set_up_in(load_site(db))


def panel_admin(user: User) -> PanelAdmin:
    return PanelAdmin(id=user.id, email=user.email, full_name=user.full_name, is_disabled=user.is_disabled)
