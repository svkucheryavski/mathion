from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from mathion.config import settings
from mathion.database import Base
from mathion.models import (  # noqa: F401
    AnswerOption,
    Block,
    Course,
    CourseAdmin,
    CourseVersion,
    Item,
    Question,
    Sequence,
)
from mathion.models_auth import (  # noqa: F401
    LoginPIN,
    RateLimitEntry,
    Session,
    StudentEnrollment,
    User,
    UserItemState,
)

config = context.config

if config.config_file_name is not None:
    # disable_existing_loggers=False: fileConfig defaults to True, which would
    # flip every already-created logger to disabled=True. When migrations run
    # in-process (the test harness's _build_schema, or any app that upgrades on
    # boot), that would silence application loggers like `mathion.notifications`.
    # Alembic's own logging config still applies; we only stop it from muting
    # loggers it doesn't own.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline():
    # Configure directly from settings.database_url — never via ConfigParser
    # (a %-encoded credential would trip BasicInterpolation).
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    # Build our own engine from settings.database_url; Alembic owning a
    # migration engine is compatible with the app's single-engine test wiring.
    connectable = create_engine(settings.database_url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
