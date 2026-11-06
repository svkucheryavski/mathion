"""Branding D8: the generated list of overridable colours matches
theme-default.css, so a new colour variable can't fall out of it."""
import importlib.util
import re
from pathlib import Path

from mathion.theme_css import parse_colour
from mathion.theme_vars import BY_NAME, NON_COLOUR_NAMES, THEME_VARS

CSS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "styles" / "theme-default.css"

GENERATOR = Path(__file__).resolve().parents[1] / "scripts" / "gen_theme_vars.py"
_VAR = re.compile(r"var\(\s*(--[\w-]+)\s*\)")


def _declarations() -> list[tuple[str, str]]:
    text = re.sub(r"/\*.*?\*/", " ", CSS.read_text(), flags=re.S)
    return [(n, v.strip()) for n, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", text)]


def test_theme_vars_match_css():
    colours: dict[str, str] = {}
    for name, value in _declarations():
        ref = _VAR.fullmatch(value)
        # The parser is the oracle, not the generator's own pattern.
        if parse_colour(value) is not None or (ref and ref.group(1) in colours):
            colours[name] = value
    assert [(v.name, v.default) for v in THEME_VARS] == list(colours.items())
    others = {name for name, _ in _declarations()} - set(colours)
    assert NON_COLOUR_NAMES == others


def test_counts():
    assert len(THEME_VARS) == 73
    assert len(NON_COLOUR_NAMES) == 23
    assert "--focus-shadow" in NON_COLOUR_NAMES
    assert BY_NAME["--toast-info"].heading == "Toast"
    assert BY_NAME["--toast-info"].default == "#0a7ea4"
    assert BY_NAME["--focus-0"].default == "var(--surface)"
    assert set(BY_NAME) == {v.name for v in THEME_VARS}


def test_every_section_has_a_heading():
    assert all(v.heading for v in THEME_VARS)
    assert [h for h in dict.fromkeys(v.heading for v in THEME_VARS)] == [
        "Page and surfaces", "Text", "Borders", "Primary", "Gold", "Status colours", "Toast",
        "Danger button", "Confirm buttons", "Danger panel", "Avatars", "Progress heat map",
        "Submission status", "Version badges",
    ]


def test_headings_follow_sections():
    assert {n: BY_NAME[n].heading for n in (
        "--bg", "--focus-1", "--focus-line-strong", "--ordinal", "--border-box", "--primary-press",
        "--gold-text", "--success", "--toast-info", "--danger-off-text", "--cancel-press",
        "--danger-panel-fg", "--avatar-fig", "--heat-fg", "--status-rejected-fg", "--state-disabled-fg",
    )} == {
        "--bg": "Page and surfaces", "--focus-1": "Page and surfaces", "--focus-line-strong": "Page and surfaces",
        "--ordinal": "Text", "--border-box": "Borders", "--primary-press": "Primary", "--gold-text": "Gold",
        "--success": "Status colours", "--toast-info": "Toast", "--danger-off-text": "Danger button",
        "--cancel-press": "Confirm buttons", "--danger-panel-fg": "Danger panel", "--avatar-fig": "Avatars",
        "--heat-fg": "Progress heat map", "--status-rejected-fg": "Submission status",
        "--state-disabled-fg": "Version badges",
    }


def _generator(css_text, tmp_path):
    css = tmp_path / "theme.css"
    css.write_text(css_text)
    spec = importlib.util.spec_from_file_location("gen_theme_vars", GENERATOR)
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.CSS = css
    gen.ROOT = tmp_path  # a successful run writes under tmp_path, never the real module
    (tmp_path / "mathion").mkdir()
    return gen


def test_generator_reads_a_wrapped_section_heading(tmp_path):
    gen = _generator(":root {\n  /* --- toast\n     more words --- */\n  --toast-info: #0a7ea4;\n}\n", tmp_path)
    assert gen.read() == ([("--toast-info", "#0a7ea4", "toast")], [])


def test_generator_fails_on_an_unmapped_section(tmp_path, capsys):
    gen = _generator(":root {\n  /* --- brand new --- */\n  --x: #fff;\n}\n", tmp_path)
    assert gen.main() == 1
    assert "'brand new'" in capsys.readouterr().err


def test_generator_writes_under_its_root(tmp_path):
    gen = _generator(":root {\n  /* --- toast --- */\n  --toast-info: #0a7ea4;\n}\n", tmp_path)
    assert gen.main() == 0
    assert "ThemeVar('--toast-info', '#0a7ea4', 'Toast')" in (tmp_path / "mathion" / "theme_vars.py").read_text()
