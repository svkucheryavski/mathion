"""Task 6: file planning and the pure converter (OLX import)."""
import json
from datetime import date
from decimal import Decimal
from html import escape

import time

import pytest
from pydantic import ValidationError

import mathion.olx.convert as convert_mod
from mathion.markdown import extract_asset_filenames
from mathion.olx.bundle import AppEntry, CheckBody, StaticEntry
from mathion.olx.convert import PlanBlock, PlanItem, PlanSequence, convert, final_label, make_slug, unfinished_label
from mathion.olx.files import Limits, Upload, plan_files, unique_name
from mathion.olx.report import Report
from mathion.olx.quiz import PlanOption, PlanQuestion
from tests.test_olx_tree import fixture_files

LIMITS = Limits(max_file_bytes=10_000, max_total_bytes=50_000)
PAGE = '<html display_name="Text"><p>Hello</p></html>'
DISCUSSION = '<discussion display_name="Talk here"/>'
QUIZ = ("<problem display_name='Quiz'><p>Q?</p><multiplechoiceresponse><choicegroup>"
        "<choice correct='true'>a</choice><choice correct='false'>b</choice></choicegroup></multiplechoiceresponse></problem>")


def graasta(name):
    return f'<html display_name="App"><iframe src="https://graasta.com/apps/{name}/"></iframe></html>'


def page(body, name="Text"):
    return f'<html display_name="{escape(name)}">{body}</html>'


def build(chapters, policy=None, course_attrs="", static=(), apps=()):
    """The plan for a course given as [(chapter, [(subsection, [(unit, [component xml])])])], all inline."""
    def attrs(title):
        if isinstance(title, tuple):                       # (title, extra attributes)
            return f'display_name="{escape(title[0])}" {title[1]}'
        return f'display_name="{escape(title)}"'
    body = "".join(
        f"<chapter {attrs(c)}>" + "".join(
            f"<sequential {attrs(s)}>" + "".join(
                f"<vertical {attrs(u)}>{''.join(comps)}</vertical>" for u, comps in units)
            + "</sequential>" for s, units in seqs)
        + "</chapter>" for c, seqs in chapters)
    files = {"course.xml": '<course url_name="r" org="o" course="c"/>',
             "course/r.xml": f'<course display_name="C" {course_attrs}>{body}</course>'}
    if policy is not None:
        files["policies/r/policy.json"] = json.dumps({"course/r": policy})
    return convert(CheckBody(files=files, static=[StaticEntry(path=p, size=s, skipped=k) for p, s, k in static],
                             apps=[AppEntry(name=n, size=s) for n, s in apps]), LIMITS)


def one(comps, unit="Unit", **kw):
    return build([("Ch", [("Seq", [(unit, comps)])])], **kw)


def texts(plan):
    return [ln.text for ln in plan.report.lines()]


def lines(plan):
    return [(ln.level, ln.where, ln.text) for ln in plan.report.lines()]


def blockers(plan):
    return [ln.text for ln in plan.report.blockers]


def items(plan):
    return [it for b in plan.blocks for s in b.sequences for it in s.items]


def fixture_body():
    return CheckBody(files=fixture_files(),
                     static=[StaticEntry(path="img/fig 1.png", size=67), StaticEntry(path="notes.pdf", size=586)],
                     apps=[AppEntry(name="sine-demo.js", size=409)])


def test_convert_fixture_summary():
    plan = convert(fixture_body(), LIMITS)
    assert blockers(plan) == []
    assert plan.summary == {"blocks": 2, "sequences": 3, "items": 12, "videos": 3, "pages": 3, "apps": 1,
                            "quizzes": 5, "files": 3, "bytes": 1062}
    assert plan.course_name == "Synthetic Demo Course"
    assert plan.label == "Open edX (unfinished): Synthetic Demo Course"
    assert plan.max_quiz_attempts == 2
    first = plan.blocks[0].sequences[0].items
    assert [(i.type, i.title) for i in first] == [("static_page", "Welcome"), ("video", "Intro video"),
                                                  ("interactive_app", "Sine demo"), ("static_page", "Reading"),
                                                  ("video", "Vimeo clip")]
    assert first[2].app_target == "sine-demo.js"
    assert not any("sine-demo" in t and ("not linked" in t or "not used" in t) for t in texts(plan))
    assert any(t.endswith(": 1 video") for t in texts(plan))            # the start/end time note
    assert plan.linked_assets == {"fig-1.png", "notes.pdf"}
    assert plan.used_app_targets == {"sine-demo.js"}
    assert sorted((u.source, u.target, u.kind) for u in plan.uploads) == [
        ("img/fig 1.png", "fig-1.png", "static"), ("notes.pdf", "notes.pdf", "static"), ("sine-demo.js", "sine-demo.js", "app")]
    assert not any("attempts" in t for t in texts(plan))


def test_item_titles_single_and_multi_component():
    plan = build([("Ch", [("Seq", [("Lesson", [PAGE]), ("Pair", [page("<p>a</p>", ""), page("<p>b</p>", "B"), page("<p>c</p>", "")])])])])
    assert [i.title for i in items(plan)] == ["Lesson", "Pair", "B", "Pair (3)"]


def test_titles_and_slugs_non_latin_and_duplicates():
    plan = build([("Øvelse 1", [("Задача", [("Video", [PAGE]), ("Video", [PAGE]), ("Video", [PAGE])])])])
    block = plan.blocks[0]
    seq = block.sequences[0]
    assert (block.title, block.slug) == ("Øvelse 1", "velse-1")
    assert (seq.title, seq.slug) == ("Задача", "sequence-1")
    assert [(i.title, i.slug) for i in seq.items] == [("Video", "video"), ("Video", "video-2"), ("Video", "video-3")]
    plan = build([("Ch", [("Seq", [("Задача", [PAGE]), ("Задача", [PAGE])])])])
    assert [i.slug for i in items(plan)] == ["item-1", "item-2"]


def test_slug_cut_and_fallbacks():
    assert make_slug("word " * 18, "item-1", set()) == "-".join(["word"] * 15)
    assert make_slug("abcde " * 12 + "abcd tail", "item-1", set()) == "abcde-" * 12 + "abcd"
    assert make_slug("a" * 37 + " " + "b" * 38, "item-1", set()) == "a" * 37 + "-" + "b" * 38
    assert make_slug("x" * 90, "item-1", set()) == "x" * 76
    assert make_slug("Задача", "item-4", set()) == "item-4"
    assert make_slug("Задача", "item-4", {"item-4"}) == "item-4-2"
    taken = {"x" * 76} | {f"{'x' * 76}-{n}" for n in range(2, 100)}
    assert len(make_slug("x" * 90, "item-1", taken)) <= 80
    assert make_slug("", "block-3", set()) == "block-3"


def test_caps_block_after_skipping():
    chapters = [(f"Ch {n}", [("Seq", [("U", [PAGE])])]) for n in range(1, 9)]
    ok = build(chapters + [(("Hidden", 'visible_to_staff_only="true"'), [("Seq", [("U", [PAGE])])])])
    assert blockers(ok) == [] and len(ok.blocks) == 8
    bad = build(chapters + [("Ch 9", [("Seq", [("U", [PAGE])])])])
    assert len(blockers(bad)) == 1 and "“Ch 9”" in blockers(bad)[0] and "“Ch 8”" not in blockers(bad)[0]


def test_caps_after_pruning_empty():
    chapters = [(f"Ch {n}", [("Seq", [("U", [PAGE])])]) for n in range(1, 9)]
    plan = build(chapters + [("Talk only", [("Seq", [("U", [DISCUSSION])])])])
    assert blockers(plan) == [] and len(plan.blocks) == 8


def test_sequence_cap():
    plan = build([("Big chapter", [(f"Seq {n}", [("U", [PAGE])]) for n in range(1, 10)])])
    assert len(blockers(plan)) == 1 and "“Big chapter”" in blockers(plan)[0]


def test_used_app_over_file_limit_blocks():
    plan = one([graasta("sine-demo")], apps=[("sine-demo.js", 20_000)])
    assert any("sine-demo.js" in b for b in blockers(plan))
    plan = one([PAGE], apps=[("big.js", 20_000)])
    assert blockers(plan) == []


def test_app_names_matched_in_sanitized_form():
    plan = one([graasta("sine-demo")], apps=[("Sine Demo.js", 400)])
    assert items(plan)[0].app_target == "sine-demo.js"
    assert Upload("Sine Demo.js", "sine-demo.js", "app", 400) in plan.uploads


def test_long_collision_suffix_within_255():
    name = "a" * 251 + ".png"
    second = unique_name(name, {name})
    assert len(second) <= 255 and second.endswith("-2.png")
    taken = {name, second}
    third = unique_name(name, taken)
    assert len(third) <= 255 and third.endswith("-3.png") and third not in taken
    plan = one([PAGE], static=[(f"x/{name}", 10, None), (f"y/{name}", 10, None)])
    targets = [u.target for u in plan.uploads]
    assert len(set(targets)) == 2 and all(len(t) <= 255 for t in targets)


def test_problem_max_attempts_differs_reported():
    plan = one([QUIZ.replace("<problem ", "<problem max_attempts='5' ")], unit="Quiz unit", policy={"max_attempts": 3})
    assert any(w.endswith("Quiz unit") and "(5)" in t and "(3)" in t for _, w, t in lines(plan))
    plan = one([QUIZ.replace("<problem ", "<problem max_attempts='3' ")], policy={"max_attempts": 3})
    assert not any("attempts" in t for t in texts(plan))
    plan = one([QUIZ.replace("<problem ", "<problem max_attempts='' ")], policy={"max_attempts": 3})
    assert not any("attempts" in t for t in texts(plan))


def test_title_cut_keeps_suffix():
    plan = one([page("<p>a</p>", ""), page("<p>b</p>", "")], unit="T" * 210)
    first, second = (i.title for i in items(plan))
    assert len(first) <= 200 and len(second) <= 200 and second.endswith(" (2)") and second.startswith("TTT")


def test_empty_sequence_and_block_dropped():
    plan = build([("A", [("Kept", [("U", [PAGE])]), ("Empty seq", [("U", [DISCUSSION])])]),
                  ("Empty chapter", [("S", [("U", [DISCUSSION])])])])
    assert [b.title for b in plan.blocks] == ["A"] and [s.title for s in plan.blocks[0].sequences] == ["Kept"]
    t = texts(plan)
    assert any("Empty seq" in w and "not created" in x for _, w, x in lines(plan))
    assert any("Empty chapter" in w and "not created" in x for _, w, x in lines(plan))
    assert any("empty unit" in x for x in t)


def test_graasta_app_matched_and_missing():
    plan = build([("Ch", [("Seq", [("Has app", [graasta("sine-demo")]), ("No app", [graasta("other")])])])],
                 apps=[("sine-demo.js", 400)])
    has, missing = items(plan)
    assert (has.type, has.app_target) == ("interactive_app", "sine-demo.js")
    assert (missing.type, missing.app_target) == ("interactive_app", None)
    assert any(w.endswith("No app") and "https://graasta.com/apps/other/" in t for _, w, t in lines(plan))
    assert plan.used_app_targets == {"sine-demo.js"}


def test_unused_app_reported_not_uploaded():
    plan = one([PAGE], apps=[("unused.js", 100)])
    assert plan.uploads == []
    assert any("unused.js" in t and "not uploaded" in t for t in texts(plan))


def test_app_name_wins_over_static_clash():
    plan = one([graasta("sine-demo")], apps=[("sine-demo.js", 100)], static=[("sine-demo.js", 50, None)])
    assert sorted((u.kind, u.source, u.target) for u in plan.uploads) == [
        ("app", "sine-demo.js", "sine-demo.js"), ("static", "sine-demo.js", "sine-demo-2.js")]


def test_colliding_static_names_resolve_links():
    body = ('<p><img src="/static/b/fig-1.png" alt="b"/> <img src="/static/c/fig_1.png" alt="c"/> '
            '<img src="/static/a/Fig 1.PNG" alt="a"/></p>')
    plan = one([page(body)], static=[("c/fig_1.png", 5, None), ("a/Fig 1.PNG", 5, None), ("b/fig-1.png", 5, None)])
    assert sorted((u.source, u.target) for u in plan.uploads) == [
        ("a/Fig 1.PNG", "fig-1.png"), ("b/fig-1.png", "fig-1-2.png"), ("c/fig_1.png", "fig-1-3.png")]
    md = items(plan)[0].content_md
    assert md == "![b](<fig-1-2.png>) ![c](<fig-1-3.png>) ![a](<fig-1.png>)"
    assert extract_asset_filenames(md) == {"fig-1.png", "fig-1-2.png", "fig-1-3.png"}


def test_skipped_entries_not_planned():
    plan = one([PAGE], static=[("e.txt", 0, "empty"), ("t.exe", 5, "type"), ("s.pdf", 99_999, "size"),
                              ("late.pdf", 20_000, None)])
    assert plan.uploads == []
    assert any("late.pdf" in t for t in texts(plan))


def test_total_over_limit_blocks():
    plan = one([PAGE], static=[(f"f{n}.pdf", 9_000, None) for n in range(6)])
    assert len(blockers(plan)) == 1 and "limit" in blockers(plan)[0]


def test_unsupported_components_skipped_with_unit_title():
    plan = build([("Ch", [("Seq", [("Talk", [DISCUSSION, PAGE])])])])
    assert any(lv == "skipped" and w.endswith("Talk") and "discussion" in t for lv, w, t in lines(plan))
    assert [i.title for i in items(plan)] == ["Talk"]


def test_column_overflow_blocks(monkeypatch):
    def fake(node, targets, report, where):
        return [PlanQuestion("single_choice", "Q", None, [PlanOption("x" * 600, True), PlanOption("b", False)])]
    monkeypatch.setattr(convert_mod, "convert_problem", fake)
    plan = one([QUIZ])
    assert any("500" in b for b in blockers(plan))

    def fake_num(node, targets, report, where):
        return [PlanQuestion("numeric_answer", "Q", None, correct_numeric=Decimal("0.00000000001"), precision=10)]
    monkeypatch.setattr(convert_mod, "convert_problem", fake_num)
    assert blockers(one([QUIZ]))


def test_unknown_asset_reference_blocks(monkeypatch):
    def fake(node, targets, report, where):
        return [PlanQuestion("text_answer", "See ![x](missing.png)", None, correct_text="a")]
    monkeypatch.setattr(convert_mod, "convert_problem", fake)
    plan = one([QUIZ])
    assert any("missing.png" in b for b in blockers(plan))


def test_max_attempts_policy_clamp_and_unlimited():
    def attempts(**kw):
        plan = one([QUIZ], **kw)
        return plan.max_quiz_attempts, [t for t in texts(plan) if "attempt" in t]
    assert attempts(policy={"max_attempts": 4}) == (4, [])
    assert attempts(policy={"max_attempts": "7"}) == (7, [])
    n, said = attempts(policy={"max_attempts": 25})
    assert n == 10 and said
    n, said = attempts(policy={"max_attempts": 0})
    assert n == 1 and said
    for value in (None, "", 2.5, "abc", "\ud800", [3], True):
        n, said = attempts(policy={"max_attempts": value})
        assert n == 10 and said, value
        assert not any("\ud800" in t or "abc" in t for t in said)
    assert attempts(policy={}, course_attrs='max_attempts="6"') == (6, [])
    n, said = attempts()
    assert n == 10 and said


def test_labels_cut_name_not_date():
    name = "N" * 250
    assert len(unfinished_label(name)) <= 200 and unfinished_label(name).startswith("Open edX (unfinished): NNN")
    final = final_label(name, date(2026, 11, 22))
    assert len(final) <= 200 and final.startswith("Open edX: NNN") and final.endswith(" (2026-11-22)")
    assert final_label("Short", date(2026, 1, 2)) == "Open edX: Short (2026-01-02)"


def test_nothing_left_blocks():
    plan = one([DISCUSSION])
    assert plan.blocks == [] and any("Nothing" in b for b in blockers(plan))


def test_unlinked_files_reported():
    plan = one([page('<p><a href="/static/used.pdf">u</a></p>')], static=[("used.pdf", 5, None), ("extra.pdf", 5, None)])
    assert {u.target for u in plan.uploads} == {"used.pdf", "extra.pdf"}
    unlinked = [t for t in texts(plan) if "not linked from any page" in t]
    assert len(unlinked) == 1 and "extra.pdf" in unlinked[0]


def test_skipped_lines_say_what_to_do():
    plan = one([page('<p><a href="/static/gone.exe">g</a></p>')], static=[("gone.exe", 5, "type")])
    assert any(t.endswith("upload the file and re-link it") for t in texts(plan))


def test_two_app_files_with_one_name():
    plan = one([graasta("sine-demo")], apps=[("Sine Demo.js", 100), ("sine_demo.js", 100)])
    assert [u.source for u in plan.uploads] == ["Sine Demo.js"]
    assert any("sine_demo.js" in t and "same name" in t for t in texts(plan))


def test_nameless_components_read_well():
    plan = one(["<video youtube_id_1_0=''/>", "<html><p></p></html>", "<poll/>"])
    for t in texts(plan):
        assert "  " not in t and "“”" not in t
    assert any(t.startswith("This video has no") and t.endswith("add the video by hand") for t in texts(plan))


# review round 1

SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


def test_repeated_names_stay_linear():
    taken, counters = {"video-2"}, {}
    assert [make_slug("Video", "item-1", taken, counters) for _ in range(3)] == ["video", "video-3", "video-4"]
    start = time.perf_counter()
    slugs = [make_slug("Video", "item-1", taken, counters) for _ in range(20_000)]
    names_taken, name_counters = set(), {}
    for _ in range(20_000):
        names_taken.add(unique_name("image.png", names_taken, name_counters))
    assert time.perf_counter() - start < 2
    assert len(set(slugs)) == 20_000 and len(names_taken) == 20_000
    start = time.perf_counter()
    plan = plan_files([StaticEntry(path=f"d{n}/image.png", size=1) for n in range(20_000)], [], set(),
                      Limits(10, 10**9), Report())
    assert time.perf_counter() - start < 2 and len({u.target for u in plan.uploads}) == 20_000


def test_targets_stay_put_when_the_per_file_limit_changes():
    mib = 1024 * 1024
    static = [StaticEntry(path="a/x.png", size=3 * mib), StaticEntry(path="b/x.png", size=mib), StaticEntry(path="c/x.png", size=mib)]
    at_check = plan_files(static, [], set(), Limits(4 * mib, 10**9), Report())
    at_build = plan_files(static, [], set(), Limits(2 * mib, 10**9), Report())
    targets = lambda plan: {u.source: u.target for u in plan.uploads}  # noqa: E731
    assert targets(at_build) == {k: v for k, v in targets(at_check).items() if k != "a/x.png"}
    assert at_build.targets.skipped == {"a/x.png": "size"}
    t = lambda files, limit: {u.source: u.target for u in plan_files(files, [], set(), Limits(limit * mib, 10**9), Report()).uploads}  # noqa: E731
    later_big = [StaticEntry(path="a/x.png", size=mib), StaticEntry(path="b/x.png", size=3 * mib), StaticEntry(path="c/x.png", size=mib)]
    assert t(later_big, 2) == {k: v for k, v in t(later_big, 4).items() if k != "b/x.png"}
    # only the server's own size skip holds a name
    assert t([StaticEntry(path="a/x.png", size=3 * mib, skipped="size"), StaticEntry(path="b/x.png", size=mib)], 4) == {"b/x.png": "x.png"}
    assert t([StaticEntry(path="a/x.png", size=0), StaticEntry(path="b/x.png", size=mib)], 4) == {"b/x.png": "x.png"}


def test_long_slug_suffixes_fit_80():
    import re
    taken, counters = set(), {}
    slugs = [make_slug("a" * 74 + " b", "item-1", taken, counters) for _ in range(1001)]
    assert len(set(slugs)) == 1001
    assert all(len(x) <= 80 and re.fullmatch(SLUG, x) for x in slugs)


def test_block_and_sequence_slugs_unique_and_numbered_by_position():
    plan = build([("Same", [("Same", [("U", [PAGE])]), ("Same", [("U", [PAGE])])]), ("Same", [("S", [("U", [PAGE])])])])
    assert [b.slug for b in plan.blocks] == ["same", "same-2"]
    assert [s.slug for s in plan.blocks[0].sequences] == ["same", "same-2"]
    plan = build([("Talk", [("S", [("U", [DISCUSSION])])]),
                  ("Øø", [("Talk", [("U", [DISCUSSION])]), ("Задача", [("U", [PAGE])])])])
    assert (plan.blocks[0].slug, plan.blocks[0].sequences[0].slug) == ("block-2", "sequence-2")


def test_title_cut_drops_trailing_space():
    plan = one([page("<p>a</p>", ""), page("<p>b</p>", "")], unit="A" * 195 + " BBBB")
    assert [i.title for i in items(plan)] == ["A" * 195 + " BBBB", "A" * 195 + " (2)"]


def test_server_repeats_type_and_empty_checks():
    body = '<p><a href="/static/run.exe">x</a> <a href="/static/noext">y</a> <a href="/static/b.PNG">z</a></p>'
    plan = one([page(body)], static=[("run.exe", 5, None), ("noext", 5, None), ("b.PNG", 0, None),
                                     ("a/x." + "q" * 300, 5, None), ("b/x." + "q" * 300, 5, None)])
    assert plan.uploads == [] and blockers(plan) == []
    assert "](" not in items(plan)[0].content_md
    t = texts(plan)
    assert sum(x.endswith("upload the file and re-link it") for x in t) == 3
    assert any("run.exe" in x and "type Mathion does not accept" in x for x in t)
    assert any("b.PNG" in x and "is empty" in x for x in t)


def test_surrogate_static_path_refused():
    with pytest.raises(ValidationError):
        StaticEntry(path="a\ud800.png", size=5)


def test_graasta_names_cleaning_to_one_file_upload_once():
    plan = build([("Ch", [("Seq", [("One", [graasta("a--b")]), ("Two", [graasta("a-b")])])])], apps=[("a-b.js", 10)])
    assert [i.app_target for i in items(plan)] == ["a-b.js", "a-b.js"]
    assert len(plan.uploads) == 1 and plan.summary["files"] == 1 and plan.summary["bytes"] == 10


def test_empty_used_app_blocks():
    plan = one([graasta("sine-demo")], apps=[("sine-demo.js", 0)])
    assert any("sine-demo.js" in b and "empty" in b for b in blockers(plan))


def test_empty_quiz_one_line():
    plan = one(["<problem display_name='P'><p>No questions here.</p></problem>"], unit="Q unit")
    assert items(plan) == []
    assert len([1 for _, w, _ in lines(plan) if w.endswith("Q unit")]) == 2         # quiz line + empty unit


def test_attempts_line_only_with_quizzes():
    assert not any("attempt" in t for t in texts(one([PAGE])))


def test_attempts_odd_values():
    def said(policy):
        plan = one([QUIZ], policy=policy)
        return plan.max_quiz_attempts, [t for t in texts(plan) if "attempt" in t]
    for value in ("\u0663", "1234567890", "abc", "3.0"):
        n, lines_ = said({"max_attempts": value})
        assert n == 10 and len(lines_) == 1 and "could not read" in lines_[0], value
    n, lines_ = said({"max_attempts": None})
    assert n == 10 and "unlimited" in lines_[0]
    plan = one([QUIZ.replace("<problem ", "<problem max_attempts='25' ")], policy={"max_attempts": 10})
    assert not any("attempt" in t for t in texts(plan))


def test_empty_page_skipped():
    plan = one([page("<p> </p>", "Blank"), PAGE])
    assert len(items(plan)) == 1
    assert any("“Blank” is empty after conversion" in t for t in texts(plan))


def test_app_lookup_in_cleaned_form_and_lines():
    plan = one([graasta("sine--demo")], apps=[("sine-demo.js", 10), ("Unused.js", 5)])
    assert items(plan)[0].app_target == "sine-demo.js"
    t = texts(plan)
    assert any("“Unused.js” is not used by any page" in x for x in t)
    assert not any("same name" in x for x in t)


def test_limits_are_inclusive():
    limits = Limits(max_file_bytes=100, max_total_bytes=300)
    report = Report()
    files = plan_files([StaticEntry(path="a.pdf", size=100), StaticEntry(path="b.pdf", size=100)],
                       [AppEntry(name="x.js", size=100)], {"x"}, limits, report)
    assert len(files.uploads) == 3 and report.blockers == [] and files.total == 300


def test_server_detected_oversize_linked_blocks_and_says_what_to_do():
    plan = one([page('<p><a href="/static/big.pdf">b</a></p>')], static=[("big.pdf", 20_000, None)])
    assert any("over the per-file limit" in b for b in blockers(plan))
    assert any("big.pdf" in t and t.endswith("upload it by hand") for t in texts(plan))


def test_total_counts_app_files():
    plan = one([graasta("sine-demo")], apps=[("sine-demo.js", 6_000)],
               static=[(f"f{n}.pdf", 9_000, None) for n in range(5)])
    assert any("limit" in b for b in blockers(plan))


def _plan(**item):
    it = PlanItem(**{"type": "static_page", "title": "T", "slug": "t", "where": "W", "content_md": "x", **item})
    return [PlanBlock("B", "b", [PlanSequence("S", "s", [it])])]


def _check(blocks, planned=frozenset()):
    report = Report()
    convert_mod._check(blocks, set(planned), report)
    return [b.text for b in report.blockers]


def test_check_columns_directly(monkeypatch):
    assert _check(_plan()) == []
    assert _check([PlanBlock("B" * 201, "b", [PlanSequence("S", "s", _plan()[0].sequences[0].items)])])
    assert _check([PlanBlock("B", "b", [PlanSequence("S", "s" * 81, _plan()[0].sequences[0].items)])])
    assert _check(_plan(slug="t" * 81))
    assert _check(_plan(title=""))
    assert _check(_plan(type="video", content_md=None, video_url="https://youtu.be/" + "a" * 484))
    assert not _check(_plan(type="video", content_md=None, video_url="https://youtu.be/" + "a" * 483))
    quiz = {"type": "quiz", "content_md": None}
    assert _check(_plan(**quiz, questions=[PlanQuestion("text_answer", " ", None, correct_text="a")]))
    assert _check(_plan(**quiz, questions=[PlanQuestion("text_answer", "Q", None, correct_text="a" * 501)]))
    assert not _check(_plan(**quiz, questions=[PlanQuestion("text_answer", "Q", None, correct_text="a" * 500)]))
    assert _check(_plan(**quiz, questions=[PlanQuestion("single_choice", "Q", None, [PlanOption("", True)])]))
    assert _check(_plan(**quiz, questions=[PlanQuestion("numeric_answer", "Q", None, correct_numeric=Decimal(1), precision=11)]))
    assert _check(_plan(**quiz, questions=[PlanQuestion("numeric_answer", "Q", None, correct_numeric=Decimal(10) ** 10, precision=0)]))
    assert any("gone.png" in b for b in _check(_plan(**quiz, questions=[
        PlanQuestion("text_answer", "Q", "See ![g](gone.png)", correct_text="a")])))
    assert _check(_plan(content_md="![g](here.png)"), {"here.png"}) == []

    def boom(md):
        raise ValueError("bad")
    monkeypatch.setattr(convert_mod, "render_markdown", boom)
    assert any("could not be rendered" in b for b in _check(_plan()))


# review round 2

def test_app_file_without_js_matches():
    plan = one([graasta("x")], apps=[("x", 10)])
    assert items(plan)[0].app_target == "x.js"
    assert plan.uploads == [Upload("x", "x.js", "app", 10)]


def test_empty_file_line_says_what_to_do():
    plan = one([PAGE], static=[("b.png", 0, None)])
    assert any("“b.png” is empty" in t and t.endswith("upload it by hand if a page needs it") for t in texts(plan))


def test_item_slug_counters_per_subsection():
    three = [("Video", [PAGE])] * 3
    plan = build([("Ch", [("A", three), ("B", three)])])
    assert [[i.slug for i in s.items] for s in plan.blocks[0].sequences] == [["video", "video-2", "video-3"]] * 2


def test_browser_marks_are_kept():
    report = Report()
    files = plan_files([StaticEntry(path="run.exe", size=5, skipped="size"), StaticEntry(path="a.png", size=0, skipped="type")],
                       [], set(), LIMITS, report)
    assert files.targets.skipped == {"run.exe": "size", "a.png": "type"}
    assert report.lines() == []


# Codex round 1

def test_targets_survive_upload_sanitizing():
    from mathion.assets import sanitize_filename
    p = "a" * 248
    body = f'<p><img src="/static/y/{p}-bc.png" alt="y"/></p>'
    plan = one([page(body)], static=[(f"x/{p}-bc.png", 5, None), (f"y/{p}-bc.png", 5, None), (f"z/{p}-2.png", 5, None)])
    targets = {u.source: u.target for u in plan.uploads}
    assert all(sanitize_filename(t) == t and len(t) <= 255 for t in targets.values())
    assert len(set(targets.values())) == 3
    assert extract_asset_filenames(items(plan)[0].content_md) == {targets[f"y/{p}-bc.png"]}


def test_truncated_collisions_stay_linear():
    def b36(i):
        digits = "0123456789abcdefghijklmnopqrstuvwxyz"
        return "".join(digits[i // 36 ** k % 36] for k in (2, 1, 0))
    names = ["a" * 248 + b36(i) + ".png" for i in range(20_000)]
    static = [StaticEntry(path=f"{d}/{n}", size=1) for d in "xy" for n in names]
    start = time.perf_counter()
    files = plan_files(static, [], set(), Limits(10, 10**9), Report())
    assert time.perf_counter() - start < 3
    assert len({u.target for u in files.uploads}) == 40_000


def test_unsupported_component_line_says_what_to_do():
    plan = one([PAGE, '<lti display_name="External lab"/>'])
    assert any("“External lab” is not supported" in t and t.endswith("recreate it by hand if students need it")
               for t in texts(plan))


def test_long_name_cut_by_sanitize_is_stable():
    from mathion.assets import sanitize_filename
    name = "a" * 250 + "-b.png"
    body = f'<p><img src="/static/x/{name}" alt="x"/></p>'
    plan = one([page(body)], static=[(f"x/{name}", 5, None)])
    target = plan.uploads[0].target
    assert sanitize_filename(target) == target
    assert extract_asset_filenames(items(plan)[0].content_md) == {target}


def test_counters_never_skip_a_free_name():
    taken, counters = set(), {}
    for _ in range(10):
        taken.add(unique_name("a" * 249 + ".png", taken, counters))
    assert "a" * 248 + "-10.png" in taken
    name = "a" * 248 + "-b.png"
    taken.add(unique_name(name, taken, counters))
    assert unique_name(name, taken, counters) == "a" * 248 + "-2.png"


# review round 4

def test_existing_numbered_names_stay_linear():
    static = [StaticEntry(path=f"a-{n}.png", size=1) for n in range(2, 20_000)]
    static += [StaticEntry(path=f"d{i}/a.png", size=1) for i in range(20_000)]
    start = time.perf_counter()
    files = plan_files(static, [], set(), Limits(10, 10**9), Report())
    assert time.perf_counter() - start < 3 and len({u.target for u in files.uploads}) == len(static)
    taken = {f"video-{n}" for n in range(2, 20_000)}
    counters = {}
    start = time.perf_counter()
    slugs = [make_slug("Video", "item-1", taken, counters) for _ in range(20_000)]
    assert time.perf_counter() - start < 3 and slugs[:2] == ["video", "video-20000"]


def test_counters_per_extension():
    files = plan_files([StaticEntry(path=p, size=1) for p in ("x/a.png", "y/a.png", "x/a.pdf", "y/a.pdf")],
                       [], set(), LIMITS, Report())
    assert sorted(u.target for u in files.uploads) == ["a-2.pdf", "a-2.png", "a.pdf", "a.png"]


def test_long_app_target_is_stable():
    from mathion.assets import sanitize_filename
    name = "a" * 251 + "-bb"
    plan = one([graasta(name)], apps=[("a" * 251 + ".js", 10)])
    target = items(plan)[0].app_target
    assert target is not None and sanitize_filename(target) == target
