"""Task 5: quiz conversion (OLX import)."""
from decimal import Decimal
from pathlib import Path

import pytest

from mathion.olx.links import LinkTargets
from mathion.olx.quiz import PlanOption, convert_problem, numeric_answer, precision_for
from mathion.olx.report import Report
from mathion.olx.tree import parse_xml

TARGETS = LinkTargets(static={"fig.png": "fig.png"}, skipped={})
FIX = Path(__file__).parent / "fixtures/olx/course/problem"


def conv(xml, report=None, where="W"):
    rep = report if report is not None else Report()
    return convert_problem(parse_xml(xml, "problem/p.xml"), TARGETS, rep, where), rep


def fixture(name, report=None):
    return conv((FIX / name).read_text(), report)


def texts(rep):
    return [ln.text for ln in rep.lines()]


def lines(rep):
    return [(ln.level, ln.where, ln.text) for ln in rep.lines()]


def mc(choices, *, text="<p>Q?</p>", tag="multiplechoiceresponse", group="choicegroup", extra=""):
    body = "".join(f'<choice correct="{c}">{t}</choice>' for t, c in choices)
    return f"<problem>{text}<{tag}><{group}>{body}</{group}>{extra}</{tag}></problem>"


def test_multiplechoice_single_and_several_correct():
    qs, rep = fixture("p_mc.xml")
    assert [q.type for q in qs] == ["single_choice", "single_choice"]
    assert qs[0].options == [PlanOption("3", False), PlanOption("4", True), PlanOption("$\\pi$", False)]
    qs, rep = conv(mc([("a", "true"), ("b", "true"), ("c", "false")]))
    assert qs[0].type == "multiple_choice" and [o.is_correct for o in qs[0].options] == [True, True, False]
    assert any("several correct choices" in t for t in texts(rep))


def test_optionresponse_both_forms():
    qs, _ = fixture("p_dropdown.xml")
    assert [q.type for q in qs] == ["single_choice", "single_choice"]
    assert qs[0].options == [PlanOption("Paris", True), PlanOption("Lyon", False), PlanOption("Nice", False)]
    assert qs[0].text_md == "The capital of France is"
    assert qs[1].options == [PlanOption("2", False), PlanOption("4", True), PlanOption("8", False)]
    assert qs[1].text_md == "The square root of 16 is"
    qs, _ = conv("<problem><p>Q</p><optionresponse><optioninput options=\"['x', 'y']\" correct='y'/></optionresponse></problem>")
    assert qs[0].options == [PlanOption("x", False), PlanOption("y", True)]
    for opts in ("__import__('os')", "('a', 1)", "('a',", "'a'"):
        qs, rep = conv(f'<problem><p>Q</p><optionresponse><optioninput options="{opts}" correct="a"/></optionresponse></problem>')
        assert qs == [], opts


def test_choiceresponse_partial_credit_reported_once():
    rep = Report()
    qs, _ = fixture("p_checkbox.xml", rep)
    fixture("p_checkbox.xml", rep)
    assert [q.type for q in qs] == ["multiple_choice", "multiple_choice"]
    assert qs[1].text_md == "Select the vowels."
    assert [o.is_correct for o in qs[0].options] == [True, True, False]
    partial = [t for t in texts(rep) if "partial credit" in t]
    assert partial == ["Checkbox questions use Mathion's partial credit: 4 questions"]


def test_numeric_default_tolerance():
    assert numeric_answer("80", None) == (Decimal("80"), 3, None)
    assert numeric_answer("0", None) == (Decimal("0"), 10, None)
    assert numeric_answer(" 80 ", "") == (Decimal("80"), 3, None)
    assert precision_for(Decimal("0.0008")) == (3, False)
    assert precision_for(Decimal("0.5")) == (0, False)
    assert precision_for(Decimal("5e-11")) == (10, False)
    assert precision_for(Decimal("4.9e-11")) == (10, True)
    assert precision_for(Decimal("0")) == (10, True)


def test_numeric_absolute_and_percent_tolerance():
    assert numeric_answer("3.14", "0.01")[:2] == (Decimal("3.14"), 2)
    assert numeric_answer("80", "5%")[:2] == (Decimal("80"), 0)
    assert numeric_answer("9.81", "1%")[:2] == (Decimal("9.81"), 1)
    assert numeric_answer("-80", "5 %")[:2] == (Decimal("-80"), 0)


def test_numeric_range():
    correct, p, note = numeric_answer("[0.026, 0.029]", None)
    assert (correct, p) == (Decimal("0.0275"), 3) and "range narrowed to" in note
    correct, p, note = numeric_answer("(1, 2)", "5%")                    # tolerance ignored; open ends excluded
    assert (correct, p) == (Decimal("1.5"), 1) and "range narrowed to" in note
    assert numeric_answer("[0, 0.0003]", None)[:2] == (Decimal("0.00015"), 4)
    assert numeric_answer("[1, 1.000000000003]", None)[0] == Decimal("1.0000000000")   # midpoint rounded to 10
    with pytest.raises(ValueError):
        numeric_answer("[2, 1]", None)


def test_numeric_widened_and_narrowed_notes():
    correct, p, note = numeric_answer("1", "1e-13")
    assert (correct, p) == (Decimal("1"), 10) and "tolerance widened" in note
    correct, p, note = numeric_answer("3", "0.7")
    assert p == 0 and "tolerance narrowed" in note
    assert numeric_answer("3", "0.5")[2] is None
    assert numeric_answer("0", "0")[2] is None                            # an answer of 0 is never widened
    correct, p, note = numeric_answer("2", "0")
    assert p == 10 and "tolerance widened" in note


def test_numeric_skips():
    for answer in ("x+1", "$a", "1e10", "-1e10", "12345678901", "0.12345678901", "1,5", "NaN", "Infinity", "", "1_000",
                   "1e999999999", "١٢", "0x10"):
        with pytest.raises(ValueError):
            numeric_answer(answer, None)
    assert numeric_answer("0.1234567890000", None)[0] == Decimal("0.1234567890")   # trailing zeros normalised
    assert numeric_answer("9999999999", None)[0] == Decimal("9999999999")


def test_scientific_notation():
    assert numeric_answer("1.5e-3", None)[0] == Decimal("0.0015")
    assert numeric_answer("2E2", None)[0] == Decimal("200")
    assert numeric_answer("2E2", None)[0].as_tuple().exponent == 0


def test_numeric_questions_from_fixture():
    qs, rep = fixture("p_numeric.xml")
    assert [(q.type, q.correct_numeric, q.precision) for q in qs] == [("numeric_answer", Decimal("80"), 3),
                                                                      ("numeric_answer", Decimal("9.81"), 1)]
    assert qs[0].text_md == "What is $0.5 \\times 160$?"


def test_unreadable_tolerance_uses_default():
    correct, p, note = numeric_answer("80", "abc")
    assert (correct, p) == (Decimal("80"), 3) and "tolerance could not be read" in note


def test_stringresponse():
    rep = Report()
    qs, _ = fixture("p_string.xml", rep)
    assert [(q.type, q.correct_text) for q in qs] == [("text_answer", "Copenhagen"), ("text_answer", "mean")]
    t = texts(rep)
    assert any("København" in x and "dropped" in x for x in t)
    fixture("p_string.xml", rep)
    assert [x for x in texts(rep) if "ignoring case" in x] == ["Text answers are now checked ignoring case: 2 questions"]
    qs, rep = conv('<problem><p>Q</p><stringresponse answer="a.*" type="regexp ci"><textline/></stringresponse></problem>')
    assert qs == [] and any("pattern" in x for x in texts(rep))
    qs, rep = conv('<problem><p>Q</p><stringresponse answer="  " type="ci"><textline/></stringresponse></problem>')
    assert qs == []
    qs, rep = conv(f'<problem><p>Q</p><stringresponse answer="{"x" * 501}" type="ci"><textline/></stringresponse></problem>')
    assert qs == []


def test_unsupported_response_and_script_skipped():
    qs, rep = conv("<problem><p>Q</p><formularesponse answer='x'><textline/></formularesponse>"
                   "<p>R</p><numericalresponse answer='1'><textline/></numericalresponse></problem>")
    assert [q.text_md for q in qs] == ["R"]
    assert any("formularesponse" in x and "add this question in the quiz editor" in x for x in texts(rep))
    qs, rep = conv("<problem><script type='loncapa/python'>a = 1</script><p>Q</p>"
                   "<numericalresponse answer='1'><textline/></numericalresponse></problem>")
    assert qs == [] and any("script" in x and "quiz editor" in x for x in texts(rep))
    qs, rep = conv("<problem><p>Q</p><customresponse cfn='check'><textline/></customresponse></problem>")
    assert qs == []


def test_question_text_both_layouts():
    qs, _ = fixture("p_mc.xml")
    assert qs[0].text_md == "Which number is even?"
    assert qs[1].text_md == "What is $2 + 3$?\n\nPick one."


def test_question_text_excludes_solution_hints_inputs():
    xml = ("<problem><p>Q1</p><numericalresponse answer='1'><responseparam type='tolerance' default='0.1'/>"
           "<textline/><correcthint>yes</correcthint><hintgroup><stringhint/></hintgroup></numericalresponse>"
           "<solution><p>Sol 1</p></solution><p>Q2</p><stringresponse answer='a' type='ci'><additional_answer answer='b'/>"
           "<stringequalhint answer='c'>no</stringequalhint><textline/></stringresponse></problem>")
    qs, _ = conv(xml)
    assert [q.text_md for q in qs] == ["Q1", "Q2"]
    assert qs[0].explanation_md == "Sol 1" and qs[1].explanation_md is None


def test_explanation_minus_leading_explanation_paragraph():
    qs, _ = fixture("p_mc.xml")
    assert [q.explanation_md for q in qs] == ["4 is divisible by 2.", "Add them."]
    for head in ("<p>Explanation:</p>", "<p><b>Explanation</b></p>", "<h4>EXPLANATION</h4>"):
        qs, _ = conv(f"<problem><p>Q</p><numericalresponse answer='1'><textline/></numericalresponse>"
                     f"<solution>{head}<p>Because.</p></solution></problem>")
        assert qs[0].explanation_md == "Because.", head
    qs, _ = conv("<problem><p>Q</p><numericalresponse answer='1'><textline/></numericalresponse>"
                 "<solution><p>Explanation of the steps.</p></solution></problem>")
    assert qs[0].explanation_md == "Explanation of the steps."
    qs, _ = conv("<problem><p>Q</p><numericalresponse answer='1'><textline/></numericalresponse>"
                 "<solution><p>Explanation</p></solution></problem>")
    assert qs[0].explanation_md is None


def test_text_after_last_response_appended_to_explanation():
    qs, rep = conv("<problem><p>Q</p><numericalresponse answer='1'><textline/></numericalresponse>"
                   "<solution><p>Sol</p></solution><p>Remember units.</p></problem>")
    assert qs[0].explanation_md == "Sol\n\nRemember units."
    assert any("after the last question" in x for x in texts(rep))
    qs, rep = conv("<problem><p>Q</p><numericalresponse answer='1'><textline/></numericalresponse><p>Tail</p></problem>")
    assert qs[0].explanation_md == "Tail"


def test_choice_rules():
    cases = {
        "empty": mc([('<img src="/static/fig.png"/>', "true"), ("b", "false")]),
        "longer than 500": mc([("x" * 501, "true"), ("b", "false")]),
        "fewer than 2": mc([("a", "true")]),
        "no correct": mc([("a", "false"), ("b", "false")]),
    }
    for why, xml in cases.items():
        qs, rep = conv(xml)
        assert qs == [], why
        assert any(why in x and "add this question in the quiz editor" in x for x in texts(rep)), (why, texts(rep))
    qs, _ = conv(mc([("x" * 500, "true"), ("b", "false")]))
    assert len(qs[0].options[0].text) == 500


def test_choice_text_math_and_escapes():
    qs, _ = conv(mc([("\\(x^2\\) is *big*", "true"), ("costs $5 \\&amp; more", "false")]))
    assert [o.text for o in qs[0].options] == ["$x^2$ is *big*", "costs \\$5 \\\\& more"]
    qs, _ = conv(mc([("a &lt; b", "true"), ("  spaced\n  out ", "false")]))
    assert [o.text for o in qs[0].options] == ["a < b", "spaced out"]


def test_choicehint_and_code_lost_reported_once_per_quiz():
    xml = mc([("<code>x</code> one<choicehint>h1</choicehint>", "true"), ("<code>y</code><choicehint>h2</choicehint>", "false")])
    xml = xml.replace("</problem>", "") + xml[len("<problem>"):]
    qs, rep = conv(xml)
    assert len(qs) == 2 and qs[0].options[0].text == "x one"
    t = texts(rep)
    assert sum("Formatting in choices" in x for x in t) == 1
    assert sum("Hints and feedback" in x for x in t) == 1
    qs, rep2 = conv(xml, rep, where="W2")
    assert sum("Formatting in choices" in x for x in texts(rep2)) == 2       # once per quiz, not per course


def test_empty_question_text_skipped():
    qs, rep = conv("<problem><numericalresponse answer='1'><textline/></numericalresponse></problem>")
    assert qs == [] and any("no question text" in x and "quiz editor" in x for x in texts(rep))
    qs, _ = conv("<problem><numericalresponse answer='1'><textline label='How many?'/></numericalresponse></problem>")
    assert qs[0].text_md == "How many?"


def test_dropped_attributes_reported_once():
    rep = Report()
    fixture("p_mc.xml", rep)
    fixture("p_mc.xml", rep)
    t = texts(rep)
    assert [x for x in t if "shuffle" in x.lower()] == ["Shuffled choices now keep their written order: 2 quizzes"]
    assert [x for x in t if "show answer" in x.lower()] == ["The \"show answer\" setting was dropped: 2 quizzes"]
    assert not any("weight" in x.lower() or "rerandomize" in x.lower() for x in t)


def test_unsupported_choice_math_reported_with_where():
    qs, rep = conv(mc([("\\(\\color{red}x\\)", "true"), ("b", "false")]), where="Block › Seq › Unit")
    assert qs[0].options[0].text == "$\\color{red}x$"
    assert any(w == "Block › Seq › Unit" and "Formula could not be typeset" in t for _, w, t in lines(rep))


def test_demandhint_reported_once_per_quiz():
    qs, rep = fixture("p_mc.xml")
    assert sum("on request" in x for x in texts(rep)) == 1
    assert not any("Count on your fingers" in (q.text_md + (q.explanation_md or "")) for q in qs)


def test_skipped_question_says_what_to_do():
    qs, rep = conv("<problem><p>Q</p><imageresponse><imageinput/></imageresponse></problem>")
    skipped = [t for lv, _, t in lines(rep) if lv == "skipped"]
    assert skipped and all(t.endswith("add this question in the quiz editor") for t in skipped)


def test_several_inputs_in_one_response_skipped():
    qs, rep = conv("<problem><p>Q</p><optionresponse><optioninput options=\"('a','b')\" correct='a'/>"
                   "<optioninput options=\"('c','d')\" correct='d'/></optionresponse></problem>")
    assert qs == [] and any("several" in x for x in texts(rep))


def test_problem_without_questions_reported():
    qs, rep = conv("<problem><p>Just text.</p></problem>")
    assert qs == [] and any("no questions" in x for x in texts(rep))


def test_question_text_links_and_images():
    qs, _ = conv("<problem><p>See <img src='/static/fig.png' alt='fig'/></p>"
                 "<numericalresponse answer='1'><textline/></numericalresponse></problem>")
    assert "fig.png" in qs[0].text_md


def test_skipped_question_numbers():
    qs, rep = conv("<problem><p>Q1</p><numericalresponse answer='x'><textline/></numericalresponse>"
                   "<p>Q2</p><numericalresponse answer='2'><textline/></numericalresponse></problem>")
    assert [q.text_md for q in qs] == ["Q2"]
    assert any(x.startswith("Question 1 was skipped") for x in texts(rep))


def test_group_level_hints_reported():
    xml = mc([("a", "true"), ("b", "false")], tag="choiceresponse", group="checkboxgroup").replace(
        "</checkboxgroup>", "<compoundhint value='A'>Only a.</compoundhint></checkboxgroup>")
    qs, rep = conv(xml)
    assert [o.text for o in qs[0].options] == ["a", "b"]
    assert sum("Hints and feedback" in x for x in texts(rep)) == 1


def num_q(answer="1", inner="<textline/>", text="<p>Q</p>"):
    return f"<problem>{text}<numericalresponse answer='{answer}'>{inner}</numericalresponse></problem>"


def test_nested_solution_never_in_question_text():
    qs, _ = conv("<problem><p>Q1</p><stringresponse answer='a' type='ci'><textline/></stringresponse>"
                 "<div><solution><p>SECRET1</p></solution></div>"
                 "<p>Q2</p><stringresponse answer='b' type='ci'><textline/></stringresponse></problem>")
    assert [(q.text_md, q.explanation_md) for q in qs] == [("Q1", "SECRET1"), ("Q2", None)]
    qs, _ = conv("<problem><stringresponse answer='a' type='ci'><p>Q1</p><div><solution><p>SECRET</p></solution></div>"
                 "<textline/></stringresponse></problem>")
    assert (qs[0].text_md, qs[0].explanation_md) == ("Q1", "SECRET")


def test_nested_hints_never_in_question_text():
    qs, rep = conv("<problem><stringresponse answer='a' type='ci'><p>Q1 <span><choicehint>H</choicehint></span></p>"
                   "<div><correcthint>CH</correcthint></div><textline/></stringresponse></problem>")
    assert qs[0].text_md == "Q1"
    assert sum("Hints and feedback" in x for x in texts(rep)) == 1


def test_wrapped_response_skips_problem():
    for xml in ("<problem><div><p>Q1</p><multiplechoiceresponse><choicegroup><choice correct='true'>R</choice>"
                "<choice correct='false'>W</choice></choicegroup><solution><p>S</p></solution></multiplechoiceresponse></div>"
                "<p>Q2</p><numericalresponse answer='5'><formulaequationinput/></numericalresponse></problem>",
                "<problem><p>What is 2+2? <numericalresponse answer='4'><textline/></numericalresponse></p></problem>"):
        qs, rep = conv(xml)
        assert qs == [] and any("inside other elements" in x and "quiz editor" in x for x in texts(rep))


def test_tolerance_inside_input():
    qs, rep = conv(num_q("80", "<textline><responseparam type='tolerance' default='5%'/></textline>"))
    assert qs[0].precision == 0 and any("tolerance narrowed" in x for x in texts(rep))
    qs, _ = conv(num_q("80", "<responseparam type='other' default='5%'/><textline/>"))
    assert qs[0].precision == 3


def test_or_answers_split_like_open_edx():
    qs, rep = conv("<problem><p>Q</p><stringresponse answer='Paris_or_paris' type='cs'><textline/></stringresponse></problem>")
    assert qs[0].correct_text == "Paris" and any("“paris”" in x and "dropped" in x for x in texts(rep))
    qs, _ = conv("<problem><p>Q</p><stringresponse answer='cat_OR_dog' type='ci'><textline/></stringresponse></problem>")
    assert qs[0].correct_text == "cat_OR_dog"
    qs, rep = conv("<problem><p>Q</p><stringresponse answer='_or_x' type='ci'><textline/></stringresponse></problem>")
    assert qs == []


def test_old_dropdown_parsed_like_open_edx():
    def opts(literal, correct):
        qs, _ = conv(f'<problem><p>Q</p><optionresponse><optioninput options="{literal}" correct="{correct}"/>'
                     f'</optionresponse></problem>')
        return qs[0].options if qs else None
    assert opts("('\\beta','b')", "b") == [PlanOption("\\beta", False), PlanOption("b", True)]
    assert opts("('it\\'s','b')", "b")[0].text == "it's"
    assert opts("('don't','b')", "b")[0].text == "don't"
    assert opts("('say \\'hi\\'','b')", "b")[0].text == "say 'hi'"
    assert opts("('a\\x00','b')", "b")[0].text == "a\\x00"
    assert opts("(' a ','b')", "a")[0].is_correct
    assert opts("('a, 'b')", "a") is None
    assert opts("(&quot;x&quot;,'c')", "c") is None               # double quotes are not quotes to Open edX


def test_solutions_go_to_their_own_question():
    qs, _ = conv("<problem><solution><p>S0</p></solution><p>Q1</p><numericalresponse answer='1'><textline/></numericalresponse>"
                 "<solution><p>S1</p></solution><p>Q2</p><numericalresponse answer='2'><textline/></numericalresponse>"
                 "<solution><p>S2</p></solution>between<p>Q3</p><numericalresponse answer='3'><textline/></numericalresponse>"
                 "<solution><p>S3</p></solution><p>Tail</p></problem>")
    assert [(q.text_md, q.explanation_md) for q in qs] == [
        ("Q1", "S0\n\nS1"), ("Q2", "S2"), ("between\n\nQ3", "S3\n\nTail")]


def test_tail_after_skipped_last_question_reported():
    qs, rep = conv("<problem><p>Q1</p><numericalresponse answer='1'><textline/></numericalresponse>"
                   "<p>Q2</p><customresponse><textline/></customresponse><p>Closing words</p></problem>")
    assert qs[0].explanation_md is None
    assert any("after the last question was dropped" in x for x in texts(rep))


def test_no_notes_for_question_skipped_for_empty_text():
    qs, rep = conv(num_q("80000", text=""))
    assert qs == [] and [lv for lv, _, _ in lines(rep)] == ["skipped"]


def test_text_before_and_inside_response_not_glued():
    qs, _ = conv("<problem>What is 2+2?<numericalresponse answer='4'>Enter it<textline/></numericalresponse></problem>")
    assert qs[0].text_md == "What is 2+2?\n\nEnter it"


def test_numeric_edge_pins():
    assert numeric_answer("0.00000000000", None) == (Decimal(0), 10, None)
    assert numeric_answer("-0e-50", None)[:2] == (Decimal(0), 10)
    correct, p, note = numeric_answer("[0, 0.0009]", None)
    assert (correct, p) == (Decimal("0.00045"), 4)
    assert "E" not in numeric_answer("[0, 0.0000001]", None)[2]
    assert numeric_answer("[0.0261, 0.0294]", None)[:2] == (Decimal("0.0278"), 3)
    assert numeric_answer("[1, 1.00000000004]", None)[0] == Decimal(1)
    correct, p, note = numeric_answer("[1, 1]", None)
    assert p == 10 and "tolerance widened" in note
    with pytest.raises(ValueError):
        numeric_answer("[-1e10, 1e10]", None)
    assert numeric_answer("0", "0.01")[:2] == (Decimal(0), 2)
    assert "could not be read" in numeric_answer("3", "-0.5")[2]


def test_report_pins():
    _, rep = conv("<problem><p>Q</p><stringresponse answer='a' type='ci'><textline/></stringresponse></problem>")
    assert not any("ignoring case" in x for x in texts(rep))
    _, rep = conv(mc([("a", "true"), ("b", "false")]))
    assert texts(rep) == []
    _, rep = conv(mc([("a", "true"), ("b", "false")]).replace("<choicegroup>", "<choicegroup shuffle='True'>"))
    assert any("Shuffled" in x for x in texts(rep))
    _, rep = conv("<problem><p>Q</p><stringresponse answer='a' type='ci'><correcthint>yes</correcthint><textline/>"
                  "<additional_answer answer=''/></stringresponse></problem>")
    assert texts(rep) == ["Hints and feedback were dropped"]
    _, rep = conv("<problem><p>Q</p><stringresponse answer='a' type='ci'><additional_answer>dog</additional_answer>"
                  "<textline/></stringresponse></problem>")
    assert any("“dog”" in x for x in texts(rep))


def test_structure_pins():
    qs, _ = conv(mc([("a", "true"), ("b", "false")], group="checkboxgroup"))
    assert qs == []
    qs, _ = conv(num_q(inner="<textline label='x &lt;script&gt;y'/>", text=""))
    assert "script" in qs[0].text_md
    qs, _ = conv("<problem>a &lt;script&gt;b&lt;/script&gt; c<numericalresponse answer='1'><textline/></numericalresponse></problem>")
    assert "script" in qs[0].text_md
    qs, rep = conv(num_q(text="<p>Q</p><div><script>x = 1</script></div>"))
    assert qs == []
    qs, _ = conv("<problem><numericalresponse answer='1'><description>B</description><description>C</description>"
                 "<textline/></numericalresponse></problem>")
    assert qs[0].text_md == "B\n\nC"
    qs, _ = conv(f"<problem><p>Q</p><stringresponse answer='{'x' * 500}' type='ci'><textline/></stringresponse></problem>")
    assert len(qs[0].correct_text) == 500


def test_huge_old_dropdown_skipped_fast():
    import time
    start = time.perf_counter()
    qs, rep = conv(f'<problem><p>Q</p><optionresponse><optioninput options="(\'{"a" * 2_000_000}\',\'b\')" correct="b"/>'
                   f'</optionresponse></problem>')
    assert qs == [] and time.perf_counter() - start < 2
    assert any("too long" in x for x in texts(rep))
    qs, _ = conv(f'<problem><p>Q</p><optionresponse><optioninput options="(\'{"a" * 500}\',\'b\')" correct="b"/>'
                 f'</optionresponse></problem>')
    assert len(qs) == 1


def test_prune_is_linear():
    import time
    start = time.perf_counter()
    qs, _ = conv("<problem><stringresponse answer='a' type='ci'><div>" + "<b>x</b><choicehint>h</choicehint>" * 100_000
                 + "</div><textline/></stringresponse></problem>")
    assert len(qs) == 1 and time.perf_counter() - start < 10


def test_prune_keeps_tails_in_order():
    qs, _ = conv("<problem><p>A<solution>s</solution>B<choicehint>h</choicehint>C<textline/>D<b>E</b>F<demandhint/>G</p>"
                 "<numericalresponse answer='1'>T0<textline/>T1<solution>s</solution>T2<responseparam/>T3"
                 "</numericalresponse></problem>")
    assert qs[0].text_md == "ABCD**E**FG\n\nT0T1T2T3"


def test_solutions_in_document_order():
    qs, _ = conv("<problem><solution>BEFORE</solution><p>Q1</p><numericalresponse answer='1'><textline/>"
                 "<solution>INSIDE</solution></numericalresponse><solution>AFTER</solution></problem>")
    assert qs[0].explanation_md == "BEFORE\n\nINSIDE\n\nAFTER"
    qs, _ = conv("<problem><p>Q1</p><numericalresponse answer='1'><textline/></numericalresponse>"
                 "<div><solution>S1</solution><solution>S1b</solution><p>Q2</p></div>"
                 "<numericalresponse answer='2'><textline/></numericalresponse><div><solution>S2</solution></div></problem>")
    assert [(q.text_md, q.explanation_md) for q in qs] == [("Q1", "S1\n\nS1b"), ("Q2", "S2")]


def test_unsupported_response_skipped_before_text():
    _, rep = conv("<problem><imageresponse><p>Click the cat</p><imageinput src='/static/cat.png'/></imageresponse></problem>")
    assert texts(rep) == ["Question 1 was skipped: its question type (imageresponse) is not supported; add this question in the quiz editor"]


def test_choice_never_holds_solution_or_input():
    qs, _ = conv(mc([("a<solution>SECRET</solution>", "true"), ("b<textline/>", "false")]))
    assert [o.text for o in qs[0].options] == ["a", "b"]


def test_inputs_inside_solution_and_nested_inputs():
    qs, _ = conv("<problem><p>Q</p><numericalresponse answer='1'><textline/>"
                 "<solution>Type it here: <textline/> ok</solution></numericalresponse></problem>")
    assert len(qs) == 1 and qs[0].explanation_md == "Type it here: ok"
    qs, _ = conv("<problem><numericalresponse answer='1'><p><textline label='LBL'/></p></numericalresponse></problem>")
    assert qs[0].text_md == "LBL"
    qs, rep = conv("<problem><p>Q</p><optionresponse><p><optioninput options=\"('a','b')\" correct='a'/></p>"
                   "<p><optioninput options=\"('c','d')\" correct='d'/></p></optionresponse></problem>")
    assert qs == [] and any("several" in x for x in texts(rep))


def test_dropped_tail_makes_no_link_lines():
    _, rep = conv("<problem><numericalresponse answer='1'><textline/></numericalresponse>"
                  "<p>after <img src='/static/missing.png'/></p></problem>")
    assert texts(rep) == ["Question 1 was skipped: it has no question text; add this question in the quiz editor",
                          "Text after the last question was dropped with it"]


def test_more_pins():
    _, rep = conv("<problem><p>Q</p><stringresponse answer='a' type='ci'><div><additional_answer answer='b'/></div>"
                  "<textline/></stringresponse></problem>")
    assert any("“b”" in x for x in texts(rep))
    qs, _ = conv("<problem><p>Q</p><stringresponse answer='Paris_OR_x_Or_y_or_z' type='ci'><textline/></stringresponse></problem>")
    assert qs[0].correct_text == "Paris_OR_x_Or_y"
    qs, _ = conv("<problem><p>Q</p><stringresponse answer='A_Or_b' type='ci'><textline/></stringresponse></problem>")
    assert qs[0].correct_text == "A_Or_b"
    qs, _ = conv("<problem><p>Q</p><optionresponse><optioninput options=\"('a b','c')\" correct='c'/></optionresponse></problem>")
    assert qs[0].options[0].text == "a b"                # quoted: one option, as in Open edX
    qs, _ = conv('<problem><p>Q</p><optionresponse><optioninput options="(\'a&#9;b\',\'c\')" correct="c"/></optionresponse></problem>')
    assert qs[0].options[0].text == "a b"
    qs, rep = conv('<problem><p>Q</p><optionresponse><optioninput options="(\'abc)" correct="a"/></optionresponse></problem>')
    assert qs == [] and any("could not be read" in x for x in texts(rep))
    qs, _ = conv("<problem><p>Q1</p><numericalresponse answer='1'><textline/></numericalresponse>after"
                 "<p>Q2</p><numericalresponse answer='2'><textline/></numericalresponse></problem>")
    assert qs[1].text_md == "after\n\nQ2"
    qs, _ = conv("<problem><numericalresponse answer='1'>a &lt;script&gt;b<textline/></numericalresponse></problem>")
    assert "script" in qs[0].text_md
    rep = Report()
    xml = mc([("a", "true"), ("b", "false")]).replace("<choicegroup>", "<choicegroup shuffle='true'>")
    conv(xml, rep, where="A")
    conv(xml, rep, where="B")
    assert [x for x in texts(rep) if "Shuffled" in x] == ["Shuffled choices now keep their written order: 2 quizzes"]


def test_explanation_never_holds_hints_or_inputs():
    qs, rep = conv("<problem><p>Q</p><stringresponse answer='a' type='ci'><textline/><solution><p>Because.</p>"
                   "<correcthint>H</correcthint><textline/></solution></stringresponse></problem>")
    assert qs[0].explanation_md == "Because."
    assert not any("not supported" in x for x in texts(rep))


def test_round3_pins():
    qs, _ = conv(num_q(inner="<responseparam type='tolerance' default='0.1'>X</responseparam><textline/>"))
    assert qs[0].text_md == "Q"
    xml = mc([("a", "true"), ("b", "false")]).replace("<choicegroup>", "<choicegroup shuffle='true'>")
    _, rep = conv(xml, where="Mine")
    assert not any(w == "Mine" and "Shuffled" in t for _, w, t in lines(rep))
    qs, _ = conv("<problem><p>Q</p><numericalresponse answer='1'><textline/></numericalresponse>"
                 "<div><div><solution>A</solution><solution>B</solution></div></div></problem>")
    assert qs[0].explanation_md == "A\n\nB"
    qs, _ = conv('<problem><p>Q</p><optionresponse><optioninput options="(\'a\',&#10;\'b\')" correct="a"/></optionresponse></problem>')
    assert qs == []
    _, rep = conv(mc([("a<solution><b>S</b></solution>", "true"), ("b", "false")]))
    assert not any("Formatting in choices" in x for x in texts(rep))
    _, rep = conv("<problem><p>Q</p><customresponse><textline/></customresponse><p></p>  </problem>")
    assert not any("dropped with it" in x for x in texts(rep))


def test_targeted_feedback_never_in_question_text():
    qs, rep = conv("<problem><multiplechoiceresponse targeted-feedback=''><label>Choose the prime.</label>"
                   "<choicegroup type='MultipleChoice'><choice correct='true'>7</choice>"
                   "<choice correct='false' explanation-id='wrong'>8</choice></choicegroup></multiplechoiceresponse>"
                   "<targetedfeedbackset><targetedfeedback explanation-id='wrong'><p>8 is composite.</p></targetedfeedback>"
                   "</targetedfeedbackset><p>What is 2+2?</p><numericalresponse answer='4'><textline/></numericalresponse></problem>")
    assert [q.text_md for q in qs] == ["Choose the prime.", "What is 2+2?"]
    assert sum("Hints and feedback" in x for x in texts(rep)) == 1


def test_range_never_accepts_outside():
    assert numeric_answer("[0.06, 1.06]", None)[:2] == (Decimal("0.56"), 0)      # more midpoint decimals before a higher p
    assert numeric_answer("[0.5, 2]", None)[:2] == (Decimal("1.2"), 0)
    assert numeric_answer("[0.00000000001, 1.00000000001]", None)[:2] == (Decimal("0.5"), 1)   # p raised
    assert numeric_answer("[0.026, 0.029]", None)[:2] == (Decimal("0.0275"), 3)
    for a in range(0, 200, 7):
        for b in range(a, 400, 13):
            lo, hi = Decimal(a) / 100, Decimal(b) / 100
            mid, p, note = numeric_answer(f"[{lo}, {hi}]", None)
            step = Decimal(5).scaleb(-(p + 1))
            assert "widened" in note or (lo <= mid - step and mid + step <= hi), (lo, hi, mid, p)


def test_prune_tails_linear():
    import time
    import xml.etree.ElementTree as ET
    from mathion.olx.quiz import _prune
    root = ET.Element("p")
    root.append(ET.Element("b"))
    for _ in range(300_000):
        e = ET.SubElement(root, "choicehint")
        e.tail = "abcdefghij"
    start = time.perf_counter()
    _prune(root, {"choicehint"})
    assert time.perf_counter() - start < 2
    assert len(root[0].tail) == 3_000_000 and len(root) == 1


def test_solutionset_like_solution():
    for xml in ("<problem><p>Q</p><multiplechoiceresponse><choicegroup><choice correct='true'>a</choice>"
                "<choice correct='false'>b</choice></choicegroup></multiplechoiceresponse>"
                "<solutionset><solution explanation-id='f1'><p>Sol A</p></solution>"
                "<solution explanation-id='f2'><p>Sol B</p></solution></solutionset></problem>",
                "<problem><p>Q</p><multiplechoiceresponse><choicegroup><choice correct='true'>a</choice>"
                "<choice correct='false'>b</choice></choicegroup><solutionset><solution><p>Sol A</p></solution>"
                "<solution><p>Sol B</p></solution></solutionset></multiplechoiceresponse></problem>"):
        qs, rep = conv(xml)
        assert (qs[0].text_md, qs[0].explanation_md) == ("Q", "Sol A\n\nSol B")
        assert not any("not supported" in x for x in texts(rep))


def test_regexphint_never_in_question_text():
    qs, rep = conv("<problem><stringresponse answer='cat' type='ci'><label>Name the animal.</label><textline/>"
                   "<regexphint answer='dog|bird'>The correct answer is cat.</regexphint></stringresponse></problem>")
    assert qs[0].text_md == "Name the animal."
    assert sum("Hints and feedback" in x for x in texts(rep)) == 1


def test_open_range_ends_never_accepted():
    assert numeric_answer("[1, 2]", None)[:2] == (Decimal("1.5"), 0)
    assert numeric_answer("[1, 2)", None)[:2] == (Decimal("1.5"), 1)
    assert numeric_answer("(1, 2]", None)[:2] == (Decimal("1.5"), 1)
    assert "widened" not in numeric_answer("[0.00000000005, 0.00000000015]", None)[2]
    assert "widened" in numeric_answer("(0.00000000005, 0.00000000015)", None)[2]      # touches both open ends at p = 10
    for lo_b, hi_b in (("(", ")"), ("[", ")"), ("(", "]")):
        for a in range(0, 200, 11):
            for b in range(a + 1, 400, 17):
                lo, hi = Decimal(a) / 100, Decimal(b) / 100
                mid, p, note = numeric_answer(f"{lo_b}{lo}, {hi}{hi_b}", None)
                step = Decimal(5).scaleb(-(p + 1))
                low_ok = lo < mid - step if lo_b == "(" else lo <= mid - step
                high_ok = mid + step < hi if hi_b == ")" else mid + step <= hi
                assert "widened" in note or (low_ok and high_ok), (lo_b, lo, hi, hi_b, mid, p)


def test_legacy_radiogroup_choiceresponse():
    qs, rep = conv("<problem><p>What is 2+2?</p><choiceresponse><radiogroup><choice correct='false'>3</choice>"
                   "<choice correct='true'>4</choice></radiogroup></choiceresponse></problem>")
    assert [(q.type, [o.is_correct for o in q.options]) for q in qs] == [("single_choice", [False, True])]
    assert not any("partial credit" in x for x in texts(rep))
    qs, rep = conv(mc([("a", "true"), ("b", "true"), ("c", "false")], tag="choiceresponse", group="radiogroup"))
    assert qs[0].type == "multiple_choice" and any("several correct choices" in x for x in texts(rep))


def _numbered(*texts_):
    body = "".join(f'<p>{t}</p><stringresponse answer="a" type="ci"><textline/></stringresponse>' for t in texts_)
    return f"<problem>{body}</problem>"


def test_own_question_number_matching_its_position_is_removed():
    rep = Report()
    qs, _ = conv(_numbered("1. First?", "2) Second?"), rep)
    conv(_numbered("1. Third?"), rep)
    assert [q.text_md for q in qs] == ["First?", "Second?"]
    assert [x for x in texts(rep) if "numbers" in x] == [
        "Question numbers at the start of the question text were removed, since Mathion numbers questions: 3 questions"]


def test_other_leading_numbers_are_kept():
    qs, rep = conv(_numbered("3. Starts at three?", "1. Out of order?", "1.5 is a number?", "2021. A year?"))
    assert [q.text_md for q in qs] == ["3\\. Starts at three?", "1\\. Out of order?", "1\\.5 is a number?", "2021\\. A year?"]
    assert not any("numbers" in x for x in texts(rep))


def test_removing_the_number_never_exposes_a_markdown_block_marker():
    qs, _ = conv(_numbered("1. # of apples?", "2. - x or + x?", "3. + 3 = 5?", "4. 1990) was the year?"))
    assert [q.text_md for q in qs] == ["\\# of apples?", "\\- x or + x?", "\\+ 3 = 5?", "1990\\) was the year?"]


def test_number_with_a_no_break_space_is_removed():
    qs, _ = conv(_numbered("1. Studio wrote this?"))
    assert [q.text_md for q in qs] == ["Studio wrote this?"]


def test_number_matching_the_open_edx_position_after_a_skipped_question_is_removed():
    xml = ('<problem><p>1. Skipped?</p><customresponse cfn="f"><textline/></customresponse>'
           '<p>2. Second?</p><stringresponse answer="a" type="ci"><textline/></stringresponse></problem>')
    qs, _ = conv(xml)
    assert [q.text_md for q in qs] == ["Second?"]


def test_a_real_list_or_a_number_in_the_text_is_never_cut_at_position_one():
    xml = ('<problem><ol><li>Pick one</li><li>Other</li></ol>'
           '<stringresponse answer="a" type="ci"><textline/></stringresponse></problem>')
    qs, rep = conv(xml)
    assert qs[0].text_md.startswith("1. Pick one")
    for text in ("1.5 kg?", "Text 1. x?", "1.", "1  kg?"):
        qs, rep = conv(_numbered(text))
        assert not qs or not any("numbers" in x for x in texts(rep)), text


def test_after_a_skipped_first_question_both_positions_count_but_no_other():
    skip = '<p>Skipped?</p><customresponse cfn="f"><textline/></customresponse>'
    one = '<stringresponse answer="a" type="ci"><textline/></stringresponse>'
    qs, _ = conv(f"<problem>{skip}<p>1. B?</p>{one}</problem>")
    assert [q.text_md for q in qs] == ["B?"]
    qs, _ = conv(f"<problem>{skip}<p>3. B?</p>{one}</problem>")
    assert [q.text_md for q in qs] == ["3\\. B?"]


def test_formatting_on_later_lines_survives_the_cut():
    one = '<stringresponse answer="a" type="ci"><textline/></stringresponse>'
    qs, _ = conv(f"<problem><p>1. Which?</p><ul><li>a</li><li>b</li></ul>{one}"
                 f"<p>2. Read:</p><blockquote>quoted</blockquote><h3>Part A</h3>{one}</problem>")
    assert [q.text_md for q in qs] == ["Which?\n\n- a\n- b", "Read:\n\n> quoted\n\n### Part A"]


def test_number_pins_spacing_width_and_skips():
    qs, _ = conv(_numbered("1.\tTabbed?"))                 # the converter turns the tab into a space
    assert [q.text_md for q in qs] == ["Tabbed?"]
    qs, _ = conv(_numbered("Text 1. x?"))
    assert [q.text_md for q in qs] == ["Text 1. x?"]
    qs, rep = conv(_numbered(*[f"{n}. Q{n}?" for n in range(1, 13)]) .replace("<p>12. Q12?</p>", "<p>1000. Q12?</p>"))
    assert qs[-1].text_md == "1000\\. Q12?" and qs[0].text_md == "Q1?" and qs[9].text_md == "Q10?"
    skip = '<p>S?</p><customresponse cfn="f"><textline/></customresponse>'
    qs, _ = conv(f'<problem>{skip}{skip}<p>2. X?</p><stringresponse answer="a" type="ci"><textline/></stringresponse></problem>')
    assert [q.text_md for q in qs] == ["2\\. X?"]
