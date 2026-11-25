"""pyproject.toml keeps out the versions with known advisories and the fastapi hold."""
import tomllib
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]


def _declared() -> dict[str, Requirement]:
    deps = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["dependencies"]
    return {canonicalize_name(r.name): r for r in map(Requirement, deps)}


@pytest.mark.parametrize("name, below_fix", [
    ("starlette", "1.3.0"), ("pydantic-settings", "2.14.1"), ("python-multipart", "0.0.30"), ("nh3", "0.3.7"),
])
def test_floors_exclude_versions_with_advisories(name, below_fix):
    assert not _declared()[name].specifier.contains(below_fix)


def test_fastapi_held_below_the_opentelemetry_release():
    assert not _declared()["fastapi"].specifier.contains("0.142.0")


def test_constraints_satisfy_the_declared_ranges():
    declared = _declared()
    for line in (ROOT / "constraints.txt").read_text().splitlines():
        if "==" in line and not line.startswith("#"):
            name, version = line.split("==")
            req = declared.get(canonicalize_name(name))
            assert req is None or req.specifier.contains(version), line
