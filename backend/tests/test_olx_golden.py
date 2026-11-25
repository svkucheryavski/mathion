"""Golden contract of the Open edX import: the server's side of frontend/src/tests/olxGolden.test.ts.

GOLDEN_UPDATE=1 rewrites check.json and build.json from the committed body.json (after the vitest update
of body.json); an update run always fails, so run both again without it.
"""
import json
import os
from pathlib import Path

import pytest

from tests.test_olx_routes import _admin_course

GOLDEN = Path(__file__).resolve().parents[2] / "frontend" / "src" / "tests" / "fixtures" / "olx-golden"
FIX = Path(__file__).parent / "fixtures" / "olx"
DATE = "2026-11-18"


def _golden(name: str):
    return json.loads((GOLDEN / name).read_text("utf-8"))


def _update(name: str, answer) -> None:
    if os.environ.get("GOLDEN_UPDATE") == "1":
        (GOLDEN / name).write_text(json.dumps(answer, indent=2, ensure_ascii=False) + "\n", "utf-8")
        pytest.fail(f"{name} rewritten: run again without GOLDEN_UPDATE")


def test_check_of_golden_body_equals_golden_check(auth_client, db, test_user):
    course, _ = _admin_course(db, test_user)
    r = auth_client.post(f"/api/courses/{course.id}/olx-import/check", json=_golden("body.json"))
    assert r.status_code == 200, r.text
    _update("check.json", r.json())
    assert r.json() == _golden("check.json")


def test_golden_build_equals_golden_answer(auth_client, db, test_user):
    _, version = _admin_course(db, test_user)
    for upload in _golden("check.json")["uploads"]:
        source = FIX / "course" / "static" / upload["source"] if upload["kind"] == "static" else FIX / "apps" / upload["source"]
        data = source.read_bytes()
        assert len(data) == upload["size"]
        r = auth_client.post(f"/api/versions/{version.id}/assets",
                             files={"file": (upload["target"], data, "application/octet-stream")})
        assert r.status_code == 201, r.text
        assert r.json()["filename"] == upload["target"]
    body = {**_golden("body.json"), "report": [], "date": DATE}
    r = auth_client.post(f"/api/versions/{version.id}/olx-import/build", json=body)
    assert r.status_code == 200, r.text
    _update("build.json", r.json())
    assert r.json() == _golden("build.json")
