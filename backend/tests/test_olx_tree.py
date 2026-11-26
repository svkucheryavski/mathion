import gzip
import io
import tarfile
from pathlib import Path

import pytest
from pydantic import ValidationError

from mathion.olx.bundle import BuildBody, CheckBody
from mathion.olx.report import Report, ReportLine
from mathion.olx.tree import OlxError, load_course, parse_xml
from tests.conftest import secs

FIXTURE = Path(__file__).parent / "fixtures" / "olx"
COURSE = FIXTURE / "course"
TAR = Path(__file__).parents[2] / "frontend" / "src" / "tests" / "fixtures" / "olx-course.tar.gz"
SKIP_DIRS = ("static/", "drafts/", "about/", "info/", "assets/", "tabs/")


def fixture_files() -> dict[str, str]:
    """The text files the browser would send for the fixture course."""
    out = {}
    for p in sorted(COURSE.rglob("*")):
        rel = p.relative_to(COURSE).as_posix()
        if p.is_file() and not rel.startswith(SKIP_DIRS) and (
            p.suffix in (".xml", ".html") or (rel.startswith("policies/") and p.suffix == ".json")
        ):
            out[rel] = p.read_text("utf-8")
    return out


def mini(chapter_body='<sequential url_name="s1"/>', seq_body='<vertical url_name="u1"/>',
         unit_body='<html url_name="h1"/>', **extra) -> dict[str, str]:
    files = {
        "course.xml": '<course url_name="r" org="o" course="c"/>',
        "course/r.xml": '<course display_name="C"><chapter url_name="c1"/></course>',
        "chapter/c1.xml": f'<chapter display_name="Ch">{chapter_body}</chapter>',
        "sequential/s1.xml": f'<sequential display_name="Seq">{seq_body}</sequential>',
        "vertical/u1.xml": f'<vertical display_name="Unit">{unit_body}</vertical>',
        "html/h1.xml": '<html filename="h1" display_name="Text"/>',
        "html/h1.html": "<p>Hello</p>",
    }
    files.update({k.replace("__", "/").replace("_DOT_", "."): v for k, v in extra.items()})
    return files


def texts(rep: Report) -> list[str]:
    return [f"{ln.level}|{ln.where}|{ln.text}" for ln in rep.lines()]


def test_fixture_tar_matches_folder():
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(TAR.read_bytes()))) as tar:
        in_tar = {m.name: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
    on_disk = {
        p.relative_to(FIXTURE).as_posix(): p.read_bytes()
        for p in COURSE.rglob("*") if p.is_file() and p.name != ".DS_Store"
    }
    assert in_tar == on_disk


def test_load_course_fixture_structure():
    rep = Report()
    tree = load_course(fixture_files(), rep)
    assert tree is not None and not rep.blockers
    assert (tree.display_name, tree.run, tree.max_attempts) == ("Synthetic Demo Course", "2026_T1", "2")
    assert [c.display_name for c in tree.chapters] == ["Week 1: Basics", "Week 2: Practice"]
    seqs = [s for c in tree.chapters for s in c.subsections]
    assert [s.display_name for s in seqs] == ["Getting started", "Choice questions", "Practice"]
    assert [[u.display_name for u in s.units] for s in seqs] == [
        ["Welcome", "Intro video", "Sine demo", "Reading and video"],
        ["Single choice", "Checkboxes", "Dropdowns", "Numbers"],
        ["Text answers", "Discussion and notes", "Embedded video"],
    ]
    two = seqs[0].units[3]
    assert [(c.tag, c.display_name) for c in two.components] == [("html", "Reading"), ("video", "Vimeo clip")]
    assert [c.tag for c in seqs[2].units[1].components] == ["discussion", "html"]
    assert seqs[1].units[0].components[0].path == "problem/p_mc.xml"
    assert seqs[0].units[0].components[0].html.startswith("<h2>Welcome</h2>")
    assert any("Staff notes" in t for t in texts(rep))


def test_course_xml_always_points_to_course_run():
    files = mini()
    files["course.xml"] = '<course url_name="r" org="o" course="c" display_name="ignored"/>'
    tree = load_course(files, Report())
    assert tree.run == "r" and tree.display_name == "C"
    files["course.xml"] = '<course org="o" course="c"/>'
    rep = Report()
    assert load_course(files, rep) is None and rep.blockers


def test_pointer_vs_inline():
    files = mini(seq_body='<vertical url_name="u1"/><vertical display_name="Inline"><html display_name="T"><p>Hello</p></html></vertical>')
    files["sequential/s1.xml"] = files["sequential/s1.xml"].replace(
        "</sequential>", '<vertical url_name="u9"><html display_name="T2"><p>Own</p></html></vertical></sequential>')
    tree = load_course(files, Report())
    units = tree.chapters[0].subsections[0].units
    assert [u.display_name for u in units] == ["Unit", "Inline", "Untitled unit 3"]
    assert units[2].components[0].html == "<p>Own</p>"
    assert units[0].path == "vertical/u1.xml" and units[1].path == "sequential/s1.xml"
    assert units[1].components[0].html == "<p>Hello</p>"


def test_html_filename_loads_html_file():
    files = mini(unit_body='<html filename="other" display_name="Inline file"/>', html__other_DOT_html="<p>Other</p>")
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert (comp.display_name, comp.html) == ("Inline file", "<p>Other</p>")
    files = mini(unit_body='<html display_name="Inline body"><p>Inside <b>here</b></p></html>')
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert comp.html == "<p>Inside <b>here</b></p>"


def test_doctype_or_entity_rejected():
    with pytest.raises(OlxError):
        parse_xml('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>', "problem/p.xml")
    files = mini(unit_body='<problem url_name="p1"/><html url_name="h1"/>',
                 problem__p1_DOT_xml='<!DOCTYPE problem><problem display_name="P"/>')
    rep = Report()
    unit = load_course(files, rep).chapters[0].subsections[0].units[0]
    assert [c.tag for c in unit.components] == ["html"]
    assert any(t.startswith("skipped|Ch › Seq › Unit|") and "problem/p1.xml" in t for t in texts(rep))
    files = mini()
    files["course/r.xml"] = '<!ENTITY x "y"><course display_name="C"/>'
    rep = Report()
    assert load_course(files, rep) is None and "course/r.xml" in rep.blockers[0].text


def test_html_doctype_html_allowed_entity_rejected():
    files = mini(html__h1_DOT_html="<!DOCTYPE html>\n<p>Hi</p>")
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert "<p>Hi</p>" in comp.html
    rep = Report()
    files = mini(html__h1_DOT_html='<!ENTITY x "y"><p>Hi</p>')
    assert load_course(files, rep).chapters[0].subsections[0].units[0].components == []
    assert any("html/h1.html" in t for t in texts(rep))


def test_depth_cap_and_cycle_skip_node():
    deep = '<html url_name="h1"/>'
    for _ in range(25):
        deep = f'<vertical display_name="Nest">{deep}</vertical>'
    rep = Report()
    unit = load_course(mini(unit_body=deep), rep).chapters[0].subsections[0].units[0]
    assert unit.components == []
    assert any("nested too deeply" in t for t in texts(rep))
    shallow = '<vertical display_name="Nest"><html url_name="h1"/></vertical>'
    unit = load_course(mini(unit_body=shallow), Report()).chapters[0].subsections[0].units[0]
    assert [c.tag for c in unit.components] == ["html"]
    rep = Report()
    unit = load_course(mini(unit_body='<vertical url_name="u1"/><html url_name="h1"/>'), rep).chapters[0].subsections[0].units[0]
    assert [c.tag for c in unit.components] == ["html"]
    assert any("vertical/u1.xml" in t and "more than once" in t for t in texts(rep))


def test_staff_only_skipped_at_every_level():
    staff = ' visible_to_staff_only="true"'
    files = mini(chapter_body='<sequential url_name="s1"/><sequential url_name="s2"/>',
                 seq_body='<vertical url_name="u1"/><vertical url_name="u2"/>',
                 unit_body=f'<html url_name="h1"/><html display_name="Hidden"{staff}><p>x</p></html>',
                 sequential__s2_DOT_xml=f'<sequential display_name="Hidden seq"{staff}/>',
                 vertical__u2_DOT_xml=f'<vertical display_name="Hidden unit"{staff}/>')
    files["course/r.xml"] = '<course display_name="C"><chapter url_name="c1"/><chapter url_name="c2"/></course>'
    files["chapter/c2.xml"] = f'<chapter display_name="Hidden chapter"{staff}><sequential url_name="missing"/></chapter>'
    rep = Report()
    tree = load_course(files, rep)
    assert not rep.blockers
    assert [c.display_name for c in tree.chapters] == ["Ch"]
    assert [s.display_name for s in tree.chapters[0].subsections] == ["Seq"]
    units = tree.chapters[0].subsections[0].units
    assert [u.display_name for u in units] == ["Unit"]
    assert [c.display_name for c in units[0].components] == ["Text"]
    got = texts(rep)
    assert any(t.startswith("skipped||") and "“Hidden chapter”" in t for t in got)
    assert any(t.startswith("skipped|Ch|") and "“Hidden seq”" in t for t in got)
    assert any(t.startswith("skipped|Ch › Seq|") and "“Hidden unit”" in t for t in got)
    assert any(t.startswith("skipped|Ch › Seq › Unit|") and "“Hidden”" in t for t in got)


def test_staff_only_unnamed_labels():
    staff = ' visible_to_staff_only="true"'
    files = mini(seq_body='<vertical url_name="u1"/><vertical url_name="u2"/>',
                 unit_body=f'<html url_name="h1"/><html{staff}><p>x</p></html>',
                 vertical__u2_DOT_xml=f'<vertical{staff}/>')
    got = texts(load_course(files, rep := Report()) and rep)
    assert "skipped|Ch › Seq|Staff-only unit 2 was not imported" in got
    assert "skipped|Ch › Seq › Unit|A staff-only html component was not imported" in got


def test_missing_pointer_file_skips_unit():
    rep = Report()
    tree = load_course(mini(seq_body='<vertical url_name="gone"/><vertical url_name="u1"/>'), rep)
    assert [u.display_name for u in tree.chapters[0].subsections[0].units] == ["Unit"]
    assert any(t.startswith("skipped|Ch › Seq|") and "vertical/gone.xml" in t for t in texts(rep))


@pytest.mark.parametrize("path,body", [
    ("course/r.xml", "<course display_name='C'><chapter"),
    ("chapter/c1.xml", "<chapter display_name='Ch'><sequential url_name='s1'/>"),
    ("sequential/s1.xml", None),
])
def test_broken_chapter_sequential_or_course_blocks(path, body):
    files = mini()
    if body is None:
        del files[path]
    else:
        files[path] = body
    rep = Report()
    assert load_course(files, rep) is None
    assert rep.blockers and path in rep.blockers[0].text


def test_pointer_with_extra_attributes_is_inline():
    files = mini(unit_body='<problem url_name="p1" display_name="Inline problem"/>',
                 problem__p1_DOT_xml='<problem display_name="From file"><p>x</p></problem>')
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert comp.display_name == "Inline problem" and len(comp.node) == 0
    assert comp.path == "vertical/u1.xml"


def test_empty_display_name_fallback():
    files = mini(chapter_body='<sequential url_name="s1"/>')
    files["chapter/c1.xml"] = '<chapter display_name="  "><sequential url_name="s1"/></chapter>'
    files["sequential/s1.xml"] = '<sequential><vertical url_name="u1"/></sequential>'
    files["vertical/u1.xml"] = '<vertical display_name=""><html url_name="h1"/></vertical>'
    rep = Report()
    tree = load_course(files, rep)
    ch = tree.chapters[0]
    assert ch.display_name == "Untitled chapter 1"
    assert ch.subsections[0].display_name == "Untitled subsection 1"
    assert ch.subsections[0].units[0].display_name == "Untitled unit 1"
    assert sum("Untitled" in t for t in texts(rep)) == 3


def test_drafts_and_about_ignored():
    files = mini(drafts__vertical__u1_DOT_xml='<vertical display_name="Draft"/>',
                 about__overview_DOT_html="<!ENTITY bad>")
    rep = Report()
    tree = load_course(files, rep)
    assert tree.chapters[0].subsections[0].units[0].display_name == "Unit"
    assert texts(rep) == []


def test_report_once_counts_and_sorts():
    rep = Report()
    rep.place("A")
    rep.place("Ch › S")
    rep.add("note", "B", "n1")
    rep.add("skipped", "Ch › S", "s1")
    for _ in range(3):
        rep.once("end", "changed", "Video end times dropped", "video|videos")
    rep.once("tr", "changed", "Transcripts dropped", "video|videos")
    rep.add("changed", "", "c0")
    rep.add("skipped", "A", "s2")
    rep.block("Ch", "bad")
    lines = rep.lines([ReportLine("skipped", "Ch › S", "s1"), ReportLine("note", "", "x")])
    assert [(ln.level, ln.where, ln.text) for ln in lines] == [
        ("skipped", "A", "s2"),
        ("skipped", "Ch › S", "s1"),
        ("changed", "", "c0"),
        ("changed", "", "Video end times dropped: 3 videos"),
        ("changed", "", "Transcripts dropped: 1 video"),
        ("note", "", "x"),
        ("note", "B", "n1"),
    ]
    assert rep.blockers == [ReportLine("skipped", "Ch", "bad")]


def test_bundle_caps():
    ok = {"files": {"course.xml": "x"}, "static": [{"path": "static/a b.png", "size": 3, "skipped": None}],
          "apps": [{"name": "a.js", "size": 1}]}
    CheckBody.model_validate(ok)
    BuildBody.model_validate({**ok, "report": [], "date": "2026-11-20"})
    CheckBody.model_validate({**ok, "files": {f"f{i}.xml": "" for i in range(20000)}})
    CheckBody.model_validate({**ok, "files": {"a.xml": "x" * (20 * 1024 * 1024)}})
    bad = [
        {**ok, "files": {f"f{i}.xml": "" for i in range(20001)}},
        {**ok, "files": {"a.xml": "x" * (20 * 1024 * 1024 + 1)}},
        {**ok, "files": {"a.xml": "é" * (10 * 1024 * 1024 + 1)}},
        {**ok, "files": {"../x": ""}},
        {**ok, "files": {"a/../x": ""}},
        {**ok, "files": {"/x": ""}},
        {**ok, "static": [{"path": "static/../x", "size": 1, "skipped": None}]},
        {**ok, "static": [{"path": "x", "size": -1, "skipped": None}]},
        {**ok, "extra": 1},
        {**ok, "files": {"a.html": "x\x00y"}},
        {**ok, "files": {"": "x"}},
        {**ok, "files": {"a\\..\\b": "x"}},
        {**ok, "static": [{"path": "x", "size": 1, "skipped": None, "more": 1}]},
        {**ok, "apps": [{"name": "a.js", "size": 1, "more": 1}]},
    ]
    for body in bad:
        with pytest.raises(ValidationError):
            CheckBody.model_validate(body)
    with pytest.raises(ValidationError):
        BuildBody.model_validate({**ok, "report": [{"level": "x", "where": "", "text": ""}], "date": "2026-11-20"})
    line = {"level": "note", "where": "", "text": ""}
    BuildBody.model_validate({**ok, "report": [line] * 20000, "date": "2026-11-20"})
    for report in ([{**line, "where": "w" * 601}], [{**line, "text": "t" * 2001}], [line] * 20001):
        with pytest.raises(ValidationError):
            BuildBody.model_validate({**ok, "report": report, "date": "2026-11-20"})


def test_colon_url_names_map_to_folders():
    files = mini(unit_body='<html url_name="wk1:intro"/>',
                 html__wk1__intro_DOT_xml='<html filename="intro" display_name="Intro"/>',
                 html__wk1__intro_DOT_html="<p>Intro</p>")
    files["sequential/s1.xml"] = '<sequential display_name="Seq"><vertical url_name="w:u1"/></sequential>'
    files["vertical/w/u1.xml"] = files.pop("vertical/u1.xml")
    rep = Report()
    comp = load_course(files, rep).chapters[0].subsections[0].units[0].components[0]
    assert comp.html == "<p>Intro</p>" and texts(rep) == []
    files["html/wk1/intro.xml"] = '<html filename="wk1:intro" display_name="Intro"/>'
    assert load_course(files, Report()).chapters[0].subsections[0].units[0].components[0].html == "<p>Intro</p>"


def test_depth_boundary():
    def nested(n):
        body = '<html display_name="Deep"><p>x</p></html>'
        for _ in range(n):
            body = f'<vertical display_name="N">{body}</vertical>'
        return load_course(mini(unit_body=body), rep := Report()).chapters[0].subsections[0].units[0], rep
    unit, _ = nested(16)
    assert [c.display_name for c in unit.components] == ["Deep"]
    unit, rep = nested(17)
    assert unit.components == [] and any("nested too deeply" in t for t in texts(rep))


def test_hostile_nesting_is_reported_not_raised():
    deep = "<div>" * 3000 + "x" + "</div>" * 3000
    rep = Report()
    files = mini(unit_body='<html url_name="deep"/><html url_name="h1"/>', html__deep_DOT_xml=f'<html display_name="I">{deep}</html>')
    unit = load_course(files, rep).chapters[0].subsections[0].units[0]
    assert [c.display_name for c in unit.components] == ["Text"]
    assert any("nested more than" in t for t in texts(rep))
    with pytest.raises(OlxError):
        parse_xml("<a>" * 201 + "</a>" * 201, "x.xml")
    parse_xml("<a>" * 200 + "</a>" * 200, "x.xml")
    rep = Report()
    files = mini(policies__r__policy_DOT_json="[" * 100000)
    assert load_course(files, rep).max_attempts is None
    assert any("policies/r/policy.json could not be read" in t for t in texts(rep))


def test_policy_settings():
    files = mini(policies__r__policy_DOT_json='{"course/r": {"max_attempts": null, "display_name": "From policy"}}')
    files["course/r.xml"] = '<course max_attempts="4"><chapter url_name="c1"/></course>'
    tree = load_course(files, Report())
    assert (tree.display_name, tree.max_attempts) == ("From policy", None)
    files["policies/r/policy.json"] = '{"course/r": {}}'
    assert load_course(files, Report()).max_attempts == "4"


def test_pointer_needs_no_text_and_html_suffix_optional():
    files = mini(unit_body='<html url_name="h1">body text</html>')
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert comp.html == "body text" and comp.path == "vertical/u1.xml"
    files = mini(html__h1_DOT_xml='<html filename="h1.html" display_name="Text"/>')
    assert load_course(files, Report()).chapters[0].subsections[0].units[0].components[0].html == "<p>Hello</p>"


def test_misplaced_and_repeated_lines_name_things():
    files = mini(chapter_body='<sequential url_name="s1"/><vertical display_name="Loose unit"/>',
                 seq_body='<vertical url_name="u1"/><problem url_name="p9"/><video display_name="Clip"/>',
                 unit_body='<html url_name="gone"/><html url_name="gone"/>')
    got = texts(load_course(files, rep := Report()) and rep)
    assert any(t.startswith("skipped|Ch|") and "“Loose unit”" in t for t in got)
    assert any(t.startswith("skipped|Ch › Seq|") and "“p9”" in t for t in got)
    assert any(t.startswith("skipped|Ch › Seq|") and "“Clip”" in t for t in got)
    gone = [t for t in got if "html/gone.xml" in t]
    assert len(gone) == 1 and "missing" in gone[0] and "by hand" in gone[0]


def test_chapter_blocker_names_the_chapter():
    files = mini()
    files["course/r.xml"] = '<course display_name="C"><chapter url_name="c1"/><chapter url_name="c2"/></course>'
    rep = Report()
    assert load_course(files, rep) is None
    assert rep.blockers[0].text.startswith("Chapter 2:") and "chapter/c2.xml" in rep.blockers[0].text


def test_lines_follow_course_order():
    files = mini(seq_body='<vertical url_name="u1"/><vertical url_name="u2"/>',
                 vertical__u2_DOT_xml='<vertical display_name="A first"><html url_name="x"/></vertical>')
    files["chapter/c1.xml"] = '<chapter display_name="Ch"><sequential url_name="s1"/><sequential url_name="s2"/></chapter>'
    files["sequential/s2.xml"] = '<sequential display_name="Later"><vertical url_name="u3"/></sequential>'
    files["vertical/u3.xml"] = '<vertical display_name="Aaa"><html url_name="y"/></vertical>'
    rep = Report()
    load_course(files, rep)
    rep.add("skipped", "Ch › Seq › Unit", "added late")
    wheres = [ln.where for ln in rep.lines([ReportLine("skipped", "A browser line", "b")])]
    assert wheres == ["Ch › Seq › Unit", "Ch › Seq › A first", "Ch › Later › Aaa", "A browser line"]


def test_bad_pointer_file_parsed_once(monkeypatch):
    import mathion.olx.tree as tree_mod
    calls = []
    real = tree_mod.parse_xml
    monkeypatch.setattr(tree_mod, "parse_xml", lambda text, path: calls.append(path) or real(text, path))
    files = mini(unit_body='<problem url_name="bad"/>' * 200, problem__bad_DOT_xml="<problem><p>")
    rep = Report()
    load_course(files, rep)
    assert calls.count("problem/bad.xml") == 1
    assert sum("problem/bad.xml" in t for t in texts(rep)) == 1


def test_colon_aliases_share_one_file():
    files = mini(unit_body='<html url_name="w:p"/><html url_name="w/p"/>',
                 html__w__p_DOT_xml='<html filename="p" display_name="P"/>', html__w__p_DOT_html="<p>W</p>")
    rep = Report()
    unit = load_course(files, rep).chapters[0].subsections[0].units[0]
    assert [c.html for c in unit.components] == ["<p>W</p>"]
    assert sum("more than once" in t for t in texts(rep)) == 1


def test_report_line_cap():
    rep = Report()
    for i in range(20005):
        rep.add("skipped", "w", f"line {i}")
    lines = rep.lines()
    assert len(lines) == 20001 and lines[0] == ReportLine("skipped", "", "5 more report lines were not shown")
    rep = Report()
    for i in range(20001):
        rep.add("note", "w", f"n{i}")
    assert rep.lines()[0].text == "1 more report line was not shown"
    rep = Report()
    for i in range(205):
        rep.block("w", f"b{i}")
    assert len(rep.blockers) == 201 and rep.blockers[-1].text == "5 more problems were not shown"


def test_html_file_next_to_pointer_wins():
    files = mini(unit_body='<html url_name="wk1:intro"/>',
                 html__wk1__intro_DOT_xml='<html filename="intro" display_name="Week intro"/>',
                 html__wk1__intro_DOT_html="<p>WEEK</p>", html__intro_DOT_html="<p>TOP</p>")
    assert load_course(files, Report()).chapters[0].subsections[0].units[0].components[0].html == "<p>WEEK</p>"
    files["vertical/u1.xml"] = '<vertical display_name="Unit"><html url_name="wk1:intro" filename="intro" display_name="I"/></vertical>'
    assert load_course(files, Report()).chapters[0].subsections[0].units[0].components[0].html == "<p>WEEK</p>"


def test_control_characters_never_reach_names():
    files = mini(policies__r__policy_DOT_json='{"course/r": {"display_name": "A\\u0000B\\u0007C"}}')
    files["course/r.xml"] = '<course><chapter url_name="c1"/></course>'
    assert load_course(files, Report()).display_name == "ABC"
    ok = {"files": {}, "static": [], "apps": []}
    for body in ({**ok, "static": [{"path": "a\x00b", "size": 1}]}, {**ok, "apps": [{"name": "a\x00.js", "size": 1}]},
                 {**ok, "files": {"a\x00": ""}}):
        with pytest.raises(ValidationError):
            CheckBody.model_validate(body)
    with pytest.raises(ValidationError):
        BuildBody.model_validate({**ok, "report": [{"level": "note", "where": "", "text": "a\x00"}], "date": "2026-11-20"})


def test_page_lines_name_the_page_and_say_what_to_do():
    files = mini(unit_body='<html url_name="h1"/>', html__h1_DOT_xml='<html filename="nofile" display_name="Lost page"/>')
    got = texts(load_course(files, rep := Report()) and rep)
    assert any("“Lost page”" in t and "html/nofile.html" in t and "by hand" in t for t in got)
    deep = '<html url_name="h1"/>'
    for _ in range(25):
        deep = f'<vertical display_name="N">{deep}</vertical>'
    got = texts(load_course(mini(unit_body=deep), rep := Report()) and rep)
    assert any("nested too deeply" in t and "by hand" in t for t in got)
    assert all(not t.endswith(".") for t in got)


def test_shared_page_file_used_once():
    files = mini(unit_body='<html filename="h1" display_name="A"/>' * 3 + '<html url_name="h1"/>')
    rep = Report()
    unit = load_course(files, rep).chapters[0].subsections[0].units[0]
    assert [c.display_name for c in unit.components] == ["A"]
    assert sum("html/h1.html is used more than once" in t for t in texts(rep)) == 1


def test_repeated_blocker_reported_once_per_place():
    files = mini()
    files["course/r.xml"] = '<course display_name="C">' + '<chapter url_name="x"/>' * 50 + "</course>"
    rep = Report()
    assert load_course(files, rep) is None and len(rep.blockers) == 1


def test_one_line_per_place_for_lost_or_reused_files():
    files = mini(seq_body='<vertical url_name="u1"/><vertical url_name="u2"/><vertical url_name="u3"/>',
                 vertical__u2_DOT_xml='<vertical display_name="Two"><html url_name="h1"/><problem url_name="gone"/></vertical>',
                 vertical__u3_DOT_xml='<vertical display_name="Three"><html url_name="h1"/><problem url_name="gone"/></vertical>')
    got = texts(load_course(files, rep := Report()) and rep)
    for unit in ("Two", "Three"):
        assert sum(t.startswith(f"skipped|Ch › Seq › {unit}|") and "html/h1.xml" in t for t in got) == 1
        assert sum(t.startswith(f"skipped|Ch › Seq › {unit}|") and "problem/gone.xml" in t for t in got) == 1


def test_names_and_labels_are_single_line_and_visible():
    files = mini(unit_body='<html url_name="gone&#10;skipped|Ch|forged"/>')
    files["vertical/u1.xml"] = files["vertical/u1.xml"].replace('display_name="Unit"', 'display_name="Un&#10;it&#x7f;"')
    files["sequential/s1.xml"] = '<sequential display_name="&#x200B;&#x202E;"><vertical url_name="u1"/></sequential>'
    rep = Report()
    tree = load_course(files, rep)
    seq = tree.chapters[0].subsections[0]
    assert seq.display_name == "Untitled subsection 1"
    assert seq.units[0].display_name == "Un it"
    assert all("\n" not in ln.where and "\n" not in ln.text for ln in rep.lines())
    files = mini(policies__r__policy_DOT_json='{"course/r": {"display_name": ["a"]}}')
    files["course/r.xml"] = '<course><chapter url_name="c1"/></course>'
    assert load_course(files, Report()).display_name == "Untitled course"
    files = mini()
    files["sequential/s1.xml"] = '<sequential display_name="ک&#x200C;ه"><vertical url_name="u1"/></sequential>'
    assert load_course(files, Report()).chapters[0].subsections[0].display_name == "ک\u200cه"


def test_skip_wording_is_consistent():
    files = mini(seq_body='<vertical url_name="u1"/><vertical url_name="gone"/>',
                 unit_body='<html url_name="h1"/><html url_name="h1"/><html filename="nofile"/>')
    rep = Report()
    load_course(files, rep)
    got = [ln.text for ln in rep.lines()]
    assert got and all(t.endswith("; add it by hand") or "first use" in t for t in got)


def test_long_names_are_cut_and_lines_bounded():
    import time
    files = mini(chapter_body='<sequential url_name="s1"/>' + "<x/>" * 2000)
    files["chapter/c1.xml"] = files["chapter/c1.xml"].replace('display_name="Ch"', f'display_name="{"N" * 1_000_000}"')
    rep = Report()
    start = time.time()
    tree = load_course(files, rep)
    assert time.time() - start < secs(5)
    assert len(tree.chapters[0].display_name) == 200
    lines = rep.lines([ReportLine("note", "w" * 5000, "t" * 5000)])
    assert all(len(ln.where) <= 600 and len(ln.text) <= 2000 for ln in lines)


def test_report_lines_are_one_clean_line():
    rep = Report()
    rep.add("skipped", "a\nb", "the file problem/ab\u202egpj.exe.xml\x9b is missing")
    rep.add("note", "W", "same text")
    lines = rep.lines([ReportLine("note", "W", "same  text"), ReportLine("note", "x\ny", "p  \u2066q")])
    assert [(ln.where, ln.text) for ln in lines] == [
        ("a b", "the file problem/abgpj.exe.xml is missing"), ("W", "same text"), ("x y", "p q")]


def test_name_marks_kept_and_invisible_names_fall_back():
    def seq_name(raw):
        files = mini()
        files["sequential/s1.xml"] = f'<sequential display_name="{raw}"><vertical url_name="u1"/></sequential>'
        return load_course(files, Report()).chapters[0].subsections[0].display_name
    assert seq_name("שלום&#x200F;!") == "שלום\u200f!"
    assert seq_name("Le&#xE7;on&#xA0;: a&#x202F;?&#x3000;b&#x9;c") == "Le\u00e7on\u00a0: a\u202f?\u3000b c"
    assert seq_name("&#x0E20;&#x0E32;&#x0E29;&#x0E32;&#x200B;&#x0E44;&#x0E17;&#x0E22;") == "\u0e20\u0e32\u0e29\u0e32\u200b\u0e44\u0e17\u0e22"
    assert seq_name("&#x645;&#x61C;1") == "\u0645\u061c1"
    for emoji in ("&#x1FAE9;", "&#x1F389;", "&#x1F1E9;&#x1F1F0;", "&#xE000;"):
        assert seq_name(emoji) != "Untitled subsection 1", emoji
    assert seq_name("&#x1F469;&#x200D;&#x1F4BB; lab") == "\U0001f469\u200d\U0001f4bb lab"
    for raw in ("&#x3164;&#x200D;", "&#x200D;", "&#xAD;", "&#x2800;", "&#x2061;", "&#x9B;&#x80;"):
        assert seq_name(raw) == "Untitled subsection 1", raw
    assert seq_name("A&#x9B;B&#x2061;C") == "ABC"


def test_missing_page_read_once_and_reported_once_per_place():
    class Counting(dict):
        reads = 0
        def get(self, key, default=None):
            if key == "html/nofile.html":
                Counting.reads += 1
            return super().get(key, default)
    files = mini(seq_body='<vertical url_name="u1"/><vertical url_name="u2"/>',
                 unit_body='<html filename="nofile" display_name="A"/>' * 3,
                 vertical__u2_DOT_xml='<vertical display_name="Two"><html filename="nofile" display_name="B"/></vertical>')
    got = texts(load_course(Counting(files), rep := Report()) and rep)
    assert Counting.reads == 1
    assert sum("html/nofile.html" in t for t in got) == 2


def test_labels_clean_raw_url_names():
    files = mini(unit_body='<problem url_name="ab&#x7f;c"/>')
    got = texts(load_course(files, rep := Report()) and rep)
    assert any("Component “abc”" in t for t in got)


def test_blocker_per_place_and_shared_page_across_units():
    files = mini(chapter_body='<sequential url_name="gone"/>')
    files["course/r.xml"] = '<course display_name="C"><chapter url_name="c1"/><chapter url_name="c2"/></course>'
    files["chapter/c2.xml"] = '<chapter display_name="Two"><sequential url_name="gone"/></chapter>'
    rep = Report()
    assert load_course(files, rep) is None and [b.where for b in rep.blockers] == ["Ch", "Two"]
    files = mini(seq_body='<vertical url_name="u1"/><vertical url_name="u2"/>',
                 vertical__u2_DOT_xml='<vertical display_name="Two"><html filename="h1" display_name="Again"/></vertical>')
    rep = Report()
    tree = load_course(files, rep)
    assert [len(u.components) for u in tree.chapters[0].subsections[0].units] == [1, 0]
    assert any(t.startswith("skipped|Ch › Seq › Two|") and "add the others by hand" in t for t in texts(rep))


def test_cap_note_after_course_level_lines():
    rep = Report()
    rep.add("skipped", "", "course-level")
    for i in range(20000):
        rep.add("skipped", "w", f"line {i}")
    assert [ln.text for ln in rep.lines()[:2]] == ["course-level", "1 more report line was not shown"]


def test_cut_lines_match_on_a_second_pass():
    rep = Report()
    where = "a" * 599 + " b"
    rep.place("x\ny")
    rep.add("skipped", where, "t")
    rep.add("skipped", "x y", "first")
    lines = rep.lines([ReportLine("skipped", where, "t")])
    assert [ln.text for ln in lines] == ["first", "t"]
    assert lines[1].where == "a" * 599


def test_namespaces_are_not_expanded():
    import tracemalloc
    uri = "u" * 100_000
    files = mini(unit_body='<html url_name="ns"/>', html__ns_DOT_xml=f'<html xmlns:p="{uri}" display_name="N">' + "<p:x/>" * 1000 + "</html>")
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert len(comp.html) < 20_000
    body = f'<problem xmlns:p="{uri}">' + "".join(f"<p:x{i}/>" for i in range(500)) + "</problem>"
    tracemalloc.start()
    node = parse_xml(body, "problem/p.xml")
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    assert peak < 10_000_000 and node[0].tag == "p:x0"
    files = mini(unit_body='<problem url_name="p1"/>', problem__p1_DOT_xml='<problem xmlns="http://example.org/x" display_name="P"/>')
    comp = load_course(files, Report()).chapters[0].subsections[0].units[0].components[0]
    assert comp.tag == "problem" and comp.display_name == "P"
    svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'
    files = mini(unit_body=f'<html display_name="Fig"><p>See</p>{svg}</html>')
    assert load_course(files, Report()).chapters[0].subsections[0].units[0].components[0].html == f"<p>See</p>{svg}".replace('r="4"/>', 'r="4" />')


def test_pointer_file_must_hold_its_own_kind():
    files = mini()
    files["course/r.xml"] = '<course display_name="C"><chapter url_name="c1"/><chapter url_name="bad"/></course>'
    files["chapter/bad.xml"] = '<html display_name="Lost chapter"><p>Important lesson</p></html>'
    rep = Report()
    assert load_course(files, rep) is None
    assert "chapter/bad.xml" in rep.blockers[0].text and "html" in rep.blockers[0].text
    files = mini(unit_body='<problem url_name="p1"/><html url_name="h1"/>', problem__p1_DOT_xml='<video display_name="V"/>')
    rep = Report()
    unit = load_course(files, rep).chapters[0].subsections[0].units[0]
    assert [c.tag for c in unit.components] == ["html"]
    assert any("problem/p1.xml" in t and "by hand" in t for t in texts(rep))
    files = mini()
    files["course/r.xml"] = '<chapter display_name="C"><chapter url_name="c1"/></chapter>'
    rep = Report()
    assert load_course(files, rep) is None and "course/r.xml" in rep.blockers[0].text
    files = mini()
    files["course.xml"] = '<html url_name="r"/>'
    rep = Report()
    assert load_course(files, rep) is None and "course.xml holds a “html”" in rep.blockers[0].text


def test_staff_only_course_blocks():
    for path in ("course.xml", "course/r.xml"):
        files = mini()
        files[path] = files[path].replace("<course ", '<course visible_to_staff_only="true" ')
        rep = Report()
        assert load_course(files, rep) is None and "staff-only" in rep.blockers[0].text, path


def test_lone_surrogates_never_reach_names():
    files = mini(policies__r__policy_DOT_json='{"course/r": {"display_name": "A\\ud800B\\udfffC"}}')
    files["course/r.xml"] = '<course><chapter url_name="c1"/></course>'
    name = load_course(files, Report()).display_name
    assert name == "ABC"
    name.encode("utf-8")


def test_byte_order_marks_never_reach_names():
    files = mini(policies__r__policy_DOT_json='{"course/r": {"display_name": "A\\ufeffB"}}')
    files["course/r.xml"] = '<course><chapter url_name="c1"/></course>'
    assert load_course(files, Report()).display_name == "AB"
