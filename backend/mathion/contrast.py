"""Readability warnings for the colours (superuser Branding spec D10).

WCAG contrast for text on its background, with the changes over the defaults
and var() followed. A translucent text colour is blended over the pair's
background; a translucent background over --bg; a translucent --bg over white.
The warnings advise and never block a save.
"""
import math

from mathion.theme_css import RGBA, resolve

RECOMMENDED = 4.5

# (text, background). D10's list; the toast's text is --primary-text on its fills.
PAIRS: tuple[tuple[str, str], ...] = (
    *((text, bg) for text in ("--text", "--text-2", "--muted") for bg in ("--bg", "--surface")),
    ("--primary", "--surface"), ("--primary", "--bg"),
    ("--primary-text", "--primary"), ("--primary-text", "--primary-press"),
    ("--primary-text", "--danger"), ("--primary-text", "--success"), ("--primary-text", "--toast-info"),
    *((f"--status-{s}-fg", f"--status-{s}-bg")
      for s in ("not-submitted", "awaiting-eval", "needs-revision", "accepted", "rejected")),
    *((f"--state-{s}-fg", f"--state-{s}-bg") for s in ("created", "published", "archived", "disabled")),
    ("--gold-text", "--gold-soft"),
    ("--danger", "--surface"),
)

_WHITE = RGBA(255, 255, 255, 1)


def _over(top: RGBA, below: RGBA) -> RGBA:
    """`top` painted over an opaque `below`."""
    a = top.a
    return RGBA(top.r * a + below.r * (1 - a), top.g * a + below.g * (1 - a), top.b * a + below.b * (1 - a), 1)


def _luminance(c: RGBA) -> float:
    def channel(x: float) -> float:
        x /= 255
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)


def ratio(text: RGBA, background: RGBA) -> float:
    """WCAG contrast of two opaque colours."""
    hi, lo = sorted((_luminance(text), _luminance(background)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def contrast_warnings(changes: dict[str, str]) -> list[str]:
    """D10: one sentence per pair below 4.5:1, in PAIRS order."""
    colours = resolve(changes)
    page = _over(colours["--bg"], _WHITE)
    warnings = []
    for text, bg in PAIRS:
        background = page if bg == "--bg" else _over(colours[bg], page)
        r = ratio(_over(colours[text], background), background)
        if r < RECOMMENDED:
            shown = math.floor(r * 10) / 10
            warnings.append(f"Text may be hard to read: `{text}` on `{bg}` is {shown:.1f}:1 (4.5:1 recommended).")
    return warnings
