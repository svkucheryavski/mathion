import argparse

from mathion.database import SessionLocal
from mathion.superuser.service import (
    DisabledUser, PinIssued, UnknownUser,
    activate_panel, create_or_promote_superuser, issue_bootstrap_pin,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m mathion.superuser")
    sub = parser.add_subparsers(dest="command", required=True)
    p_create = sub.add_parser("create-superuser")
    p_create.add_argument("email")
    p_pin = sub.add_parser("pin")
    p_pin.add_argument("email")
    sub.add_parser("activate")
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        if args.command == "create-superuser":
            try:
                user = create_or_promote_superuser(db, args.email)
            except ValueError as e:
                print(f"error: {e}")
                return 1
            print(f"{user.email} is a superuser.")
            return 0

        if args.command == "pin":
            result = issue_bootstrap_pin(db, args.email)
            if isinstance(result, PinIssued):
                print(f"PIN: {result.pin}")
                print(f"It expires in {result.minutes} minutes.")
            elif isinstance(result, UnknownUser):
                print("unknown email")
            elif isinstance(result, DisabledUser):
                print("user is disabled")
            return 0

        if args.command == "activate":
            result = activate_panel(db)
            if not result.has_superuser:
                print(
                    "warning: no superuser accounts exist — run create-superuser first, "
                    "or this URL will 404"
                )
            print(result.url)
            return 0

        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
