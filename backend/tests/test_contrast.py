"""Branding D10: readability warnings for text on its background (WCAG
contrast, var() resolved, translucent colours blended)."""
from mathion.contrast import PAIRS, contrast_warnings
from mathion.theme_vars import BY_NAME


def warning(text: str, background: str, ratio: str) -> str:
    return f"Text may be hard to read: `{text}` on `{background}` is {ratio}:1 (4.5:1 recommended)."


def test_pairs_name_theme_colours():
    assert all(t in BY_NAME and b in BY_NAME for t, b in PAIRS)
    assert len(set(PAIRS)) == len(PAIRS) == 24  # D10's list, with the toast's --toast-info added
    for pair in [("--text", "--bg"), ("--muted", "--surface"), ("--primary", "--bg"),
                 ("--primary-text", "--primary-press"), ("--primary-text", "--toast-info"),
                 ("--status-rejected-fg", "--status-rejected-bg"), ("--state-archived-fg", "--state-archived-bg"),
                 ("--gold-text", "--gold-soft"), ("--danger", "--surface")]:
        assert pair in PAIRS


def test_defaults_give_no_warning():
    assert contrast_warnings({}) == []


def test_muted_on_surface_warns():
    # #b4b4b4 is 2.07:1 on white and 1.87:1 on #F2F3F6; ratios are rounded down.
    assert contrast_warnings({"--muted": "#b4b4b4"}) == [
        warning("--muted", "--bg", "1.8"),
        warning("--muted", "--surface", "2.0"),
    ]


def test_translucent_text_blends_over_background():
    # 30% black over white is rgb(178.5, ...), 2.1:1; unblended it would be 21:1.
    assert warning("--text", "--surface", "2.1") in contrast_warnings({"--text": "rgba(0, 0, 0, .3)"})


def test_translucent_bg_blends_over_white():
    # 90% black over white is near-black, so the near-black text can't be read on it.
    assert warning("--text", "--bg", "1.0") in contrast_warnings({"--bg": "rgba(0, 0, 0, .9)"})


def test_translucent_background_blends_over_bg():
    # A transparent --surface shows --bg (black) through it; #16181D on black is 1.18:1.
    warnings = contrast_warnings({"--bg": "#000", "--surface": "transparent"})
    assert warning("--text", "--surface", "1.1") in warnings


def test_var_resolved_through_merged_set():
    assert warning("--muted", "--surface", "1.0") in contrast_warnings({"--muted": "var(--surface)"})
    assert contrast_warnings({"--surface": "#f2f3f6", "--focus-0": "var(--bg)"}) == []
