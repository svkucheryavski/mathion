"""Task 2: math and text for Markdown (OLX import)."""
import pytest

from mathion.markdown import render_markdown, render_option_text
from mathion.olx.mdtext import (
    Seg, escape_line_starts, escape_text, formula_errors, normalize_segments,
    render_segments, script_text_ok, split_math,
)


def M(text, display=False):
    return Seg("math", text, display)


def T(text):
    return Seg("text", text)


def C(text):
    return Seg("code", text)


# (input text or segments, expected Markdown, outcome, choice mode)
CASES = [
    pytest.param("\\( x \\)", "$x$", "math", False, id="trim"),
    pytest.param("\\(\\)", "", "plain", False, id="empty-dropped"),
    pytest.param("95\\(\\%\\)", "$95\\%$", "math", False, id="pull-before"),
    pytest.param("0.05\\(x\\)", "$0.05x$", "math", False, id="pull-decimal"),
    pytest.param("\\(a\\)\\(b\\)", "$a{}b$", "math", False, id="merge"),
    pytest.param("\\(a\\)2\\(b\\)", "$a{}2{}b$", "math", False, id="pull-then-merge"),
    pytest.param([M("x"), M("^{2}")], "$x^{2}$", "math", False, id="script-merge"),
    pytest.param([T("R"), M("^{2}")], "R$^{2}$", "math", False, id="script-after-letter"),
    pytest.param([T("10"), M("^{3}")], "$10^{3}$", "math", False, id="script-pulls-number"),
    pytest.param("x \\[ a \\] y", "x $$a$$ y", "math", False, id="display-mid-text"),
    pytest.param([M("a"), M("b", True)], "$a$ $$b$$", "math", False, id="inline-touching-display"),
    pytest.param([M("b", True), M("a")], "$$b$$ $a$", "math", False, id="display-touching-inline"),
    pytest.param("\\( x\\ \\)", "$x$", "math", False, id="control-space"),
    pytest.param("\\( x\\\\ \\)", "$x\\\\$", "error", False, id="kept-line-break"),
    pytest.param("\\(a\n- b\\)", "$a - b$", "math", False, id="body-newline"),
    pytest.param("\\(a$b\\)", "$a\\$b$", "math", False, id="dollar-in-body"),
    pytest.param("It costs $5", "It costs \\$5", "plain", False, id="price"),
    pytest.param("*a* _b_ [c] <d> ! & \\ `e`", "\\*a\\* \\_b\\_ \\[c\\] \\<d\\> ! & \\\\ \\`e\\`", "plain", False, id="text-escapes"),
    pytest.param("Wow! Tom &copy; &#169; &b", "Wow! Tom \\&copy; \\&#169; &b", "plain", False, id="entity-like-only"),
    pytest.param("Wow!", "Wow\\!", "plain", False, id="final-bang"),
    pytest.param("# a", "\\# a", "plain", False, id="line-hash"),
    pytest.param("1. a", "1\\. a", "plain", False, id="line-number"),
    pytest.param("- a", "\\- a", "plain", False, id="line-dash"),
    pytest.param("> a", "\\> a", "plain", False, id="line-quote"),
    pytest.param("~~~", "\\~~~", "plain", False, id="line-fence"),
    pytest.param("a*b [c] $5 \\x \\!", "a*b [c] \\$5 \\x \\\\!", "plain", True, id="choice"),
    pytest.param("[mathjaxinline]y[/mathjaxinline]", "$y$", "math", False, id="mathjaxinline"),
    pytest.param("[mathjax]y[/mathjax]", "$$y$$", "math", False, id="mathjax"),
    # beyond the spec rows
    pytest.param("\\(a\\)\\(b\\)\\(c\\)", "$a{}b{}c$", "math", False, id="merge-three"),
    pytest.param("\\(10^3\\)5", "$10^3{}5$", "math", False, id="pull-after-keeps-script"),
    pytest.param("\\[a\\]\\[b\\]", "$$a$$$$b$$", "math", False, id="displays-never-merge"),
    pytest.param("2\\[a\\]", "2$$a$$", "math", False, id="display-no-pull"),
    pytest.param("x \\( a", "x \\\\( a", "plain", False, id="unclosed"),
    pytest.param("\\\\(a\\\\)", "\\\\\\\\(a\\\\\\\\)", "plain", False, id="escaped-opener"),
    pytest.param("\\(a\\\\\\)", "$a\\\\$", "error", False, id="pair-before-closer"),
    pytest.param("[mathjaxinline]a\\[/mathjaxinline]", "$a$", "math", False, id="bare-final-backslash"),
    pytest.param("a\u00a0b \\(x\\)", "a\u00a0b $x$", "math", False, id="nbsp-kept"),
    pytest.param("a\\ \\(x\\)", "a\\ $x$", "math", True, id="choice-backslash-before-space"),
    pytest.param([T("a\\"), M("x")], "a\\\\$x$", "math", True, id="choice-backslash-before-math"),
    pytest.param("\\(\\$\\) costs", "$\\$$ costs", "math", False, id="escaped-dollar-body"),
    pytest.param("Answer \\(\\text{``yes''}\\) or \\(\\text{``no''}\\).", "Answer $\\text{\u2018\u2018yes''}$ or $\\text{\u2018\u2018no''}$.", "math", False, id="tex-quotes"),
    pytest.param("\\(\\text{`a'}\\) uses `", "$\\text{\u2018a'}$ uses \\`", "math", False, id="backtick-then-text-backtick"),
    pytest.param("0,05\\(x\\)", "$0{,}05x$", "math", False, id="pull-decimal-comma"),
    pytest.param("\\(x\\)2,5", "$x{}2{,}5$", "math", False, id="pull-after-comma"),
    pytest.param("\\(x\\)2.5", "$x{}2.5$", "math", False, id="pull-after-decimal"),
    pytest.param([T("1."), T("5"), M("x")], "$1.5x$", "math", False, id="text-runs-joined-first"),
    pytest.param([M("a"), T("1"), T("2")], "$a{}12$", "math", False, id="text-runs-joined-after"),
    pytest.param([M("x"), M("_{2}")], "$x_{2}$", "math", False, id="subscript-merge"),
    pytest.param("\\(a\\\\) b\\)", "$a\\\\) b$", "error", False, id="pair-inside-body"),
    pytest.param("\\( a\\ \\ \\)", "$a$", "math", False, id="two-control-spaces"),
    pytest.param(" # b", " \\# b", "plain", False, id="indented-hash"),
    pytest.param([C("`1*`"), M("x"), C("`$`")], "`1*`$x$`$`", "math", False, id="code-verbatim"),
    pytest.param("a \n b\t\\(x\\)", "a b $x$", "math", True, id="choice-whitespace"),
    pytest.param("\\(1\\over 2\\)3", "${1\\over 2}{}3$", "math", False, id="over-then-number"),
    pytest.param("2\\(1\\over 3\\)", "$2{1\\over 3}$", "math", False, id="number-then-over"),
    pytest.param("\\(a\\over b\\)\\(c\\over d\\)", "${a\\over b}{}{c\\over d}$", "math", False, id="two-overs"),
    pytest.param([M("a\\over b"), M("^{2}")], "${a\\over b}^{2}$", "math", False, id="over-then-script"),
    pytest.param("\\(\\rm d\\)\\(x\\)", "${\\rm d}{}x$", "error", False, id="font-switch"),
    pytest.param("\\(\\frac{1\\over 2}{3}\\)4", "$\\frac{1\\over 2}{3}{}4$", "math", False, id="nested-over-not-grouped"),
    pytest.param("\\(\\item\\)", "$\\item$", "error", False, id="item-is-not-it"),
    pytest.param("1.000,5\\(x\\)", "$1.000{,}5x$", "math", False, id="both-separators"),
    pytest.param("\\[a`b\\]", "$$a\u2018b$$", "math", False, id="backtick-display"),
    pytest.param("\\(a`b\\) or `", "$a\u2018b$ or `", "math", True, id="backtick-choice"),
    pytest.param("\\(\\text{\\`a}\\)", "$\\text{\\`a}$", "error", False, id="escaped-backtick-kept"),
    pytest.param("\\(n\\choose k\\)2", "${n\\choose k}{}2$", "math", False, id="choose-grouped"),
    pytest.param("\\(\\displaystyle x\\)2", "${\\displaystyle x}{}2$", "math", False, id="displaystyle-grouped"),
    pytest.param("3\\(\\textstyle\\frac12\\)", "$3{\\textstyle\\frac12}$", "math", False, id="textstyle-grouped"),
    pytest.param([M("\\displaystyle\\sum"), M("_{i}")], "${\\displaystyle\\sum}_{i}$", "math", False, id="displaystyle-then-script"),
    pytest.param("\\({a}\\over{b}\\)2", "${{a}\\over{b}}{}2$", "math", False, id="braced-over"),
    pytest.param("\\(\\{a\\over b\\)2", "${\\{a\\over b}{}2$", "math", False, id="escaped-brace-over"),
    pytest.param("\\(a\\\\`b\\)", "$a\\\\\u2018b$", "error", False, id="pair-before-backtick"),
    pytest.param([T("A!"), C("[L](<https://e.com>)")], "A\\![L](<https://e.com>)", "plain", False, id="bang-before-link"),
    pytest.param("&copy\\(\\);", "\\&copy;", "plain", False, id="entity-across-dropped-formula"),
    pytest.param("Exercise 2\n\\(x+1=3\\)", "Exercise 2 $x+1=3$", "math", False, id="number-before-newline"),
    pytest.param("Exercise 2\n\\(x+1=3\\)", "Exercise 2 $x+1=3$", "math", True, id="choice-number-before-newline"),
    pytest.param("Exercise 2\\(x+1=3\\)", "Exercise $2x+1=3$", "math", False, id="number-touching"),
    pytest.param("Wow!\n", "Wow! ", "plain", False, id="bang-before-newline"),
]


def _md(case_input, choice):
    segs = split_math(case_input) if isinstance(case_input, str) else list(case_input)
    segs = normalize_segments(segs)
    md = render_segments(segs, choice=choice)
    return segs, (md if choice else escape_line_starts(md))


@pytest.mark.parametrize(("case_input", "expected", "outcome", "choice"), CASES)
def test_math_text_cases(case_input, expected, outcome, choice):
    assert _md(case_input, choice)[1] == expected


@pytest.mark.parametrize(("case_input", "expected", "outcome", "choice"), CASES)
def test_rendered_output_matches_expected_outcome(case_input, expected, outcome, choice):
    segs, md = _md(case_input, choice)
    html = render_option_text(md) if choice else render_markdown(md)
    if outcome == "plain":
        assert "<math" not in html and "math-error" not in html
        assert formula_errors(segs) == []
    elif outcome == "math":
        assert html.count("<math") == sum(s.kind == "math" for s in segs) and "math-error" not in html
        assert formula_errors(segs) == []
    else:
        assert "math-error" in html
        assert formula_errors(segs)


def test_text_survives_rendering():
    assert render_markdown(escape_line_starts(render_segments(normalize_segments(split_math("It costs $5 & <b>")))))\
        == "<p>It costs $5 &amp; &lt;b&gt;</p>\n"
    assert render_option_text(render_segments(normalize_segments(split_math("a*b \\x \\! $5")), choice=True)) == "a*b \\x \\! $5"


def test_bare_urls_link_whole():
    for url in ("https://x.com/?a=1&b=2", "https://x.com/#!/p"):
        md = escape_line_starts(render_segments(normalize_segments(split_math(f"See {url} now"))))
        assert f'href="{url.replace("&", "&amp;")}"' in render_markdown(md), md


def test_empty_group_merge_typesets():
    for md in ("$a{}b$", "$\\alpha{}b$"):
        html = render_markdown(md)
        assert "<math" in html and "math-error" not in html


def test_formula_errors_reports_unsupported():
    segs = normalize_segments(split_math("\\(\\begin{align}x\\end{align}\\) and \\(\\color{red}x\\)"))
    errors = formula_errors(segs)
    assert [src for src, _ in errors] == ["\\begin{align}x\\end{align}", "\\color{red}x"]
    assert all(reason for _, reason in errors)


def test_script_text_ok():
    assert script_text_ok("max")
    for bad in ("a{b", "x$", "50%", "a\\b", "a}", "a&b", "#1", "x^y", "a_b", "a~b"):
        assert not script_text_ok(bad), bad


def test_escape_text_has_no_line_structure():
    assert escape_text("a\n\n    b\t c") == "a b c"


def test_escape_line_starts_after_hard_break():
    md = "a\\\n# b\\\n  12) c\\\n+ d\\\n= e\\\n| f\\\n~~~g"
    assert escape_line_starts(md) == "a\\\n\\# b\\\n  12\\) c\\\n\\+ d\\\n\\= e\\\n\\| f\\\n\\~~~g"


def test_split_math_kinds():
    assert split_math("a \\(x\\) b \\[y\\] [mathjaxinline]z[/mathjaxinline]") == [
        T("a "), M("x"), T(" b "), M("y", True), T(" "), M("z"),
    ]


def test_split_math_many_unclosed_openers_is_fast():
    import time
    start = time.perf_counter()
    segs = split_math("\\( [mathjax] [mathjaxinline] \\[ " * 200_000)
    assert time.perf_counter() - start < 2
    assert all(s.kind == "text" for s in segs)


def test_many_touching_formulas_is_fast():
    import time
    start = time.perf_counter()
    segs = normalize_segments(split_math("\\(a\\)1" * 200_000))
    assert time.perf_counter() - start < 2
    assert len(segs) == 1 and segs[0].text.startswith("a{}1{}a")


def test_long_number_before_formula_is_fast():
    import time
    for text in ("1" * 200_000 + "x\\(y\\)", "1," * 100_000 + "x\\(y\\)"):
        start = time.perf_counter()
        normalize_segments(split_math(text))
        assert time.perf_counter() - start < 2


def test_many_control_spaces_is_fast():
    import time
    start = time.perf_counter()
    segs = normalize_segments(split_math("\\(x" + "\\ " * 400_000 + "\\)"))
    assert time.perf_counter() - start < 2 and segs == [M("x")]
