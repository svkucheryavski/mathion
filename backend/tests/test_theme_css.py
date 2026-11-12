"""Branding D10: the theme file's closed grammar, its problems, and which
values count as changes."""
import pytest

from mathion import theme_css
from mathion.theme_css import (
    RGBA, canonical, changes_in_use, parse_colour, parse_theme, resolve, same_colour, write_stylesheet,
)
from mathion.theme_vars import THEME_VARS

NOT_A_COLOUR = ("Line {n}: `{v}` isn't a colour. Use a hex colour, rgb(), hsl() (like `hsl(210deg 30% 36%)`), "
                "a colour name or var(--another-colour).")
STRUCTURE = "Line {n}: only colour variables inside one `:root {{ }}` are allowed."


def theme(*decls: str) -> bytes:
    """A theme file whose first declaration is on line 2."""
    return (":root {\n" + "".join(f"  {d}\n" for d in decls) + "}\n").encode()


def problems(*decls: str) -> list[str]:
    return parse_theme(theme(*decls)).problems


# --- the value grammar ---

@pytest.mark.parametrize("raw, stored", [
    ("#FFF", "#fff"),
    ("#12345678", "#12345678"),
    ("rgba(63,92,119,0.5)", "rgba(63, 92, 119, 0.5)"),
    ("rgb(63 92 119 / .5)", "rgb(63 92 119 / .5)"),
    ("rgb( 10%   20% 30% )", "rgb(10% 20% 30%)"),
    ("hsl(210deg 30% 36%)", "hsl(210deg 30% 36%)"),
    ("hsla(210, 30%, 36%, 50%)", "hsla(210, 30%, 36%, 50%)"),
    ("hsl(.5turn, 30%, 36%)", "hsl(.5turn, 30%, 36%)"),
    ("rgb(1e2 2E1 +3)", "rgb(1e2 2e1 +3)"),
    ("White", "white"),
    ("TRANSPARENT", "transparent"),
    ("var( --danger )", "var(--danger)"),
])
def test_accepted_and_canonical(raw, stored):
    parsed = parse_theme(theme(f"--text: {raw};"))
    assert parsed.problems == []
    assert parsed.changes == {"--text": stored}
    assert canonical(raw) == stored


@pytest.mark.parametrize("value", [
    "rgb(50%, 0, 0)", "hsl(210, 30, 36)", "hsl(210 30 36)", "hsl(30% 40% 50%)", "rgb(1, 2 3)",
    "rgba(1 2 3 / .5)", "rgb(1, 2, 3 / .5)", "rgb(1 2)", "#12", "#12345", "1.", "rgb(1. 2 3)",
    "oklch(0.5 0.1 200)", "lab(50% 40 59)", "hwb(194 0% 0%)", "color(srgb 1 0 0)",
    "none", "currentcolor", "inherit", "initial", "unset", "revert", "Canvas", "var(--danger, #fff)",
    "rgb(1 2 3 4)", "rgb(63 92 119 .5)", "hsl(210 30% 36% 50%)", "rgb(1% 2% 3% 4%)", "rgb(1 2 3 4 / .5)",
    "hsl(1e999 50% 50%)", "rgb(1e999 0 0)", "rgb(0 0 0 / 1e999)",
])
def test_refuses_forms_browsers_drop(value):
    assert problems(f"--text: {value};") == [NOT_A_COLOUR.format(n=2, v=value)]


@pytest.mark.parametrize("value", ["url(https://x)", "expression(1)", "'red'", "re\\d", "#fff<"])
def test_refuses_outright(value):
    assert problems(f"--text: {value};") == [NOT_A_COLOUR.format(n=2, v=value)]


@pytest.mark.parametrize("value, shown", [
    ("r\u00f8d", "r\\u00f8d"),
    ("blac\u212a", "blac\\u212a"),
    ("rgb(1\u00a02 3)", "rgb(1\\u00a02 3)"),
    ("rgb(1\x1f2 3)", "rgb(1\\u001f2 3)"),
    ("rgb(1\x0b2 3)", "rgb(1\\u000b2 3)"),
    ("rgb(1 2 3)\x00", "rgb(1 2 3)\\u0000"),
])
def test_invisible_characters_are_refused_and_shown(value, shown):
    # The echo shows what made the value wrong; a copied NBSP mustn't look like a space.
    assert problems(f"--text: {value};") == [NOT_A_COLOUR.format(n=2, v=shown)]


# --- names ---

def test_unknown_names():
    assert problems("--backgroud: #fff;") == ["Line 2: `--backgroud` isn't a theme variable."]
    assert problems("--text: var(--backgroud);") == ["Line 2: `--backgroud` isn't a theme variable."]


def test_names_that_are_not_colours():
    assert problems("--radius: 12px;") == ["Line 2: `--radius` isn't a colour, so it can't be changed here."]
    assert problems("--text: var(--radius);") == ["Line 2: `--radius` isn't a colour, so it can't be referred to here."]


# --- structure ---

def test_important_is_structure():
    assert problems("--text: #000 !important;") == [STRUCTURE.format(n=2)]


def test_other_rules_are_structure():
    assert parse_theme(b"@import url(x.css);\n:root {\n  --text: #000;\n}\n").problems == [STRUCTURE.format(n=1)]
    assert parse_theme(theme("--text: #000;") + b"body {\n  --bg: #fff;\n}\n").problems == [STRUCTURE.format(n=4)]
    assert parse_theme(theme("--text: #000;") + b":root {\n  --bg: #fff;\n}\n").problems == [STRUCTURE.format(n=4)]
    assert problems("color: red;") == [STRUCTURE.format(n=2)]
    assert parse_theme(b":root {\n  --text: #000;\n  a { --bg: #fff }\n}\n").problems == [STRUCTURE.format(n=3)]
    assert parse_theme(b":root {\n  --text: #000;\n").problems == [STRUCTURE.format(n=1)]


@pytest.mark.parametrize("head", ['@CHARSET "UTF-8";', '@charset\t"utf-8";'])
def test_charset_is_ascii_case_blind(head):
    assert parse_theme(f"{head}\n:root {{ --text: #000 }}".encode()).problems == []


@pytest.mark.parametrize("head", ['@char\u017fet "utf-8";', '@charset\u00a0"utf-8";', '@charset "utf-8"\u00a0;'])
def test_charset_refuses_non_ascii(head):
    # The long s (U+017F) folds to s under Unicode case-blind matching.
    assert parse_theme(f"{head}\n:root {{ --text: #000 }}".encode()).problems == [STRUCTURE.format(n=1)]


@pytest.mark.parametrize("text", [":root{\u00a0\n--bg: #000;}", ":root{--bg:\u00a0\n#000;}"])
def test_a_no_break_space_is_reported_on_its_own_line(text):
    assert [p[:7] for p in parse_theme(text.encode()).problems] == ["Line 1:"]


def test_numbers_are_ascii_digits_only(monkeypatch):
    # Python's \d and float() take other scripts' digits; a stored value
    # with them would be written out and dropped by the browser.
    monkeypatch.setattr(theme_css, "_logged", set())
    assert parse_colour("rgb(\u0661\u0662 0 0)") is None
    assert changes_in_use({"--bg": "rgb(\u0661\u0662 0 0)"}) == {}


def test_canonical_keeps_a_no_break_space():
    # Only CSS whitespace is folded, so canonical() can't hide one either.
    assert canonical("#FFF\u00a0") == "#fff\u00a0"


def test_charset_first_only():
    assert parse_theme(b'@charset "utf-8";\n:root { --text: #000 }').changes == {"--text": "#000"}
    assert parse_theme(b':root { --text: #000 }\n@charset "utf-8";\n').problems == [STRUCTURE.format(n=2)]


def test_set_twice():
    assert problems("--bg: #fff;", "--bg: #eee;") == ["Line 3: `--bg` is set twice."]
    assert problems("--bg: nope;", "--bg: #eee;") == [NOT_A_COLOUR.format(n=2, v="nope"), "Line 3: `--bg` is set twice."]


def test_unclosed_comment():
    assert parse_theme(b":root {\n  --text: #000;\n  /* open\n}\n").problems == ["Line 3: a comment isn't closed."]


def test_loops():
    assert problems("--surface: var(--focus-0);") == ["Line 2: `--surface` refers back to itself through `--focus-0`."]
    assert problems("--bg: var(--text);", "--text: var(--bg);") == [
        "Line 2: `--bg` refers back to itself through `--text`.",
        "Line 3: `--text` refers back to itself through `--bg`.",
    ]


# --- the file ---

def test_file_problems():
    assert parse_theme(b"\xff\xfe").problems == ["The theme file must be UTF-8 text."]
    assert parse_theme(b" " * 65537).problems == ["The theme file can be at most 64 KB."]
    assert parse_theme(b"").problems == ["The theme file sets no colours."]
    assert parse_theme(b"  \n").problems == ["The theme file sets no colours."]
    assert parse_theme(b":root {}").problems == ["The theme file sets no colours."]


def test_largest_file_accepted():
    data = theme("--text: #000;")
    assert parse_theme(data + b" " * (65536 - len(data))).changes == {"--text": "#000"}


def test_bom_and_windows_lines_keep_line_numbers():
    data = b"\xef\xbb\xbf:root {\r\n  --text: #000;\r\n  --bg: nope;\r\n}\r\n"
    assert parse_theme(data).problems == [NOT_A_COLOUR.format(n=3, v="nope")]


def test_comments_keep_line_numbers_and_separate():
    assert parse_theme(b":root {\n/* one\ntwo */\n  --text: nope;\n}").problems == [NOT_A_COLOUR.format(n=4, v="nope")]
    assert parse_theme(theme("--text: rgb(1/**/2 3);")).changes == {"--text": "rgb(1 2 3)"}


def test_last_semicolon_optional():
    assert parse_theme(b":root { --text: #000; --bg: #fff }").changes == {"--text": "#000", "--bg": "#fff"}


def test_problems_capped_at_20():
    parsed = parse_theme(theme(*[f"--x{i}: #fff;" for i in range(30)]))
    assert len(parsed.problems) == 20 and parsed.more == 10
    assert parse_theme(theme("--text: #000;")).more == 0


def test_long_echo_is_cut():
    assert problems(f"--text: {'x' * 50};") == [NOT_A_COLOUR.format(n=2, v="x" * 40 + "\u2026")]


# --- equality and real changes ---

def test_same_colour():
    assert same_colour("#fff", "white")
    assert same_colour("#fff", "#ffffff")
    assert same_colour("rgb(255 255 255 / 100%)", "#FFF")
    assert same_colour("rgb(300, 0, 0)", "red")
    assert same_colour("rgb(50% 50% 50%)", "#808080")
    assert same_colour("rgb(90%, 90%, 90%)", "#e6e6e6")
    assert same_colour("hsl(120 100% 50%)", "lime")
    assert not same_colour("#fff", "#fffe")
    assert not same_colour("var(--surface)", "#ffffff")
    assert same_colour("var( --surface )", "var(--surface)")


def test_parse_colour():
    assert parse_colour("var(--surface)") is None
    assert parse_colour("nope") is None
    assert parse_colour("#0000") == RGBA(0, 0, 0, 0)
    assert parse_colour("transparent") == RGBA(0, 0, 0, 0)
    assert parse_colour("rgb(0 0 0 / 150%)").a == 1
    assert parse_colour("hsl(-120deg 100% 50%)") == parse_colour("blue")


def test_named_colour_table():
    assert len(theme_css._NAMED) == 148
    assert parse_colour("rebeccapurple") == RGBA(102, 51, 153, 1)


def test_only_real_changes_are_kept():
    assert parse_theme(theme("--cancel-hover: #EEF0F3;")).changes == {"--cancel-hover": "#eef0f3"}
    parsed = parse_theme(theme("--bg: #f2f3f6;", "--focus-0: var(--surface);"))
    assert parsed.problems == [] and parsed.changes == {}


def test_full_download_with_three_changes():
    changed = {"--bg": "#ffffff", "--primary": "rgb(10 20 30)", "--toast-info": "teal"}
    lines = ["/* Mathion colours. Change the values you want. */", ":root {"]
    heading = None
    for v in THEME_VARS:
        if v.heading != heading:
            heading = v.heading
            lines.append(f"  /* {heading} */")
        lines.append(f"  {v.name}: {changed.get(v.name, v.default)};")
    lines.append("}")
    parsed = parse_theme("\n".join(lines).encode())
    assert parsed.problems == []
    assert parsed.changes == changed


# --- the stored set ---

def test_changes_in_use():
    assert changes_in_use({"--primary": "var(--gone)"}) == {}
    assert changes_in_use({"--primary": "var(--radius)"}) == {}
    assert changes_in_use({"--gone": "#fff", "--bg": "#fff"}) == {"--bg": "#fff"}
    assert changes_in_use({"--surface": "var(--focus-0)"}) == {}
    assert changes_in_use({"--bg": "var(--text)", "--text": "var(--bg)", "--primary": "var(--bg)"}) == {
        "--primary": "var(--bg)"}


def test_changes_in_use_drops_what_isnt_a_colour():
    assert changes_in_use({"--bg": "red} body{display:none", "--text": "#000"}) == {"--text": "#000"}
    assert changes_in_use({"--bg": "RED", "--primary": "url(x)"}) == {}


def test_changes_in_use_logs_once(monkeypatch, caplog):
    monkeypatch.setattr(theme_css, "_logged", set())
    with caplog.at_level("WARNING", logger="mathion.theme_css"):
        changes_in_use({"--primary": "var(--gone)"})
        changes_in_use({"--primary": "var(--gone)"})
    assert len(caplog.records) == 1


def test_resolve():
    defaults = resolve({})
    assert len(defaults) == 73
    assert defaults["--focus-0"] == defaults["--surface"] == RGBA(255, 255, 255, 1)
    assert resolve({"--surface": "#000"})["--focus-0"] == RGBA(0, 0, 0, 1)
    assert resolve({"--cancel-hover": "var(--danger)"})["--cancel-hover"] == parse_colour("#C8102E")


def test_write_stylesheet():
    assert write_stylesheet({}) == ""
    assert write_stylesheet({"--text": "rgb(1 2 3 / .5)", "--bg": "#fff"}) == (
        ":root:root {\n  --bg: #fff;\n  --text: rgb(1 2 3 / .5);\n}\n")


# --- the echo (backlog round, Branding spec rev 15) ---

def test_empty_value_says_it_is_empty():
    help_ = NOT_A_COLOUR.format(n=2, v="x").split("isn't a colour. ", 1)[1]
    assert problems("--bg: ;") == [f"Line 2: the value is empty. {help_}"]
    assert problems("--bg:;") == [f"Line 2: the value is empty. {help_}"]


def test_echo_cuts_before_escaping():
    # The cut counts characters, so a code is never split, and the … stays one character.
    value = "x" * 39 + "\u00a0" + "yyy"
    assert problems(f"--text: {value};") == [NOT_A_COLOUR.format(n=2, v="x" * 39 + "\\u00a0\u2026")]
    assert problems("--text: rgb(\U0001f642);") == [NOT_A_COLOUR.format(n=2, v="rgb(\\U0001f642)")]


def test_a_cut_drops_the_space_before_the_ellipsis():
    assert problems(f"--text: {'x' * 39} yyy;") == [NOT_A_COLOUR.format(n=2, v="x" * 39 + "…")]


@pytest.mark.parametrize("decls, problem", [
    # D10: only CSS whitespace (space, tab, line break, form feed) separates;
    # a no-break space is a non-ASCII character and refused with its code.
    (["--bg: #fff ;"], NOT_A_COLOUR.format(n=2, v="#fff\\u00a0")),
    (["--bg: #fff;"], NOT_A_COLOUR.format(n=2, v="\\u00a0#fff")),
    (["--bg: #fff　;"], NOT_A_COLOUR.format(n=2, v="#fff\\u3000")),
    (["--bg : #000;"], "Line 2: `--bg\\u00a0` isn't a theme variable."),
    ([" --bg: #000;"], STRUCTURE.format(n=2)),
    (["--bg: #fff\v;"], NOT_A_COLOUR.format(n=2, v="#fff\\u000b")),
])
def test_only_css_whitespace_separates(decls, problem):
    assert problems(*decls) == [problem]


def test_a_no_break_space_before_root_is_refused():
    assert parse_theme(b"\xc2\xa0:root { --bg: #fff; }").problems == [STRUCTURE.format(n=1)]


def test_backtick_in_an_echo_is_escaped():
    assert problems("--text: re`d;") == [NOT_A_COLOUR.format(n=2, v="re\\u0060d")]
    assert problems("--b`g: #fff;") == ["Line 2: `--b\\u0060g` isn't a theme variable."]


def test_names_are_echoed_like_values():
    assert problems("--bg\u200b: #fff;") == ["Line 2: `--bg\\u200b` isn't a theme variable."]
    long = "--" + "n" * 60
    assert problems(f"{long}: #fff;") == [f"Line 2: `{long[:40]}\u2026` isn't a theme variable."]


def test_changes_in_use_keeps_theme_order():
    order = [v.name for v in THEME_VARS]
    stored = {"--primary": "#111111", "--bg": "#222222", "--muted": "#333333"}
    assert list(changes_in_use(stored)) == sorted(stored, key=order.index)


def test_changes_in_use_drops_values_equal_to_the_default(monkeypatch, caplog):
    # A release can make a stored colour equal Mathion's own: it is no change.
    monkeypatch.setattr(theme_css, "_logged", set())
    with caplog.at_level("WARNING", logger="mathion.theme_css"):
        assert changes_in_use({"--bg": "#f2f3f6", "--text": "#000"}) == {"--text": "#000"}
        assert changes_in_use({"--bg": "#f2f3f6", "--text": "#000"}) == {"--text": "#000"}
    # A warning, since Mathion's logging hides anything below a warning; the line says why.
    assert len(caplog.records) == 1 and caplog.records[0].getMessage() == (
        "branding: the stored colour --bg: #f2f3f6 is left out "
        "(the same as Mathion's colour now, expected after a release)")
