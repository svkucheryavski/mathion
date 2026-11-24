"""Task 4: videos and Graasta pages (OLX import)."""
import json
from pathlib import Path

import pytest

from mathion.olx.html_md import parse_html
from mathion.olx.tree import parse_xml
from mathion.olx.video import PageKind, classify_html, embed_url, to_https, video_component, with_start

CASES = json.loads((Path(__file__).parents[2] / "frontend/src/lib/videoUrlCases.json").read_text())


def vid(xml):
    return video_component(parse_xml(xml, "video/v.xml"))


@pytest.mark.parametrize("case", CASES, ids=[c["input"] for c in CASES])
def test_shared_cases_match_ts(case):
    assert embed_url(case["input"]) == case["output"]


@pytest.mark.parametrize("url", ["", "  ", "https://example.com/video", "not a url", "https://www.youtube.com/playlist?list=PL1",
                                 "https://vimeo.com/channels/staffpicks", "https://player.vimeo.com/x", "example.com/v.mp4",
                                 "https://youtu.be/", "https://www.youtube.com/watch", "https://www.youtube.com/embed/",
                                 "https://www.youtube.com/watch?v=a%22b", "mailto:x@youtube.com", "https://[bad/watch?v=x",
                                 "javascript://www.youtube.com/embed/x"])
def test_embed_url_rejects(url):
    assert embed_url(url) is None


def test_to_https():
    assert to_https("//e.com/x") == "https://e.com/x"
    assert to_https("HTTP://E.com/X") == "https://E.com/X"
    assert to_https("Https://e.com") == "https://e.com"
    assert to_https(" https://e.com ") == "https://e.com"
    assert to_https("mailto:a@b.c") == "mailto:a@b.c"


def test_with_start():
    assert with_start("https://www.youtube.com/embed/x", 65) == "https://www.youtube.com/embed/x?start=65"
    assert with_start("https://www.youtube.com/embed/x?rel=0&start=3", 65) == "https://www.youtube.com/embed/x?rel=0&start=65"
    assert with_start("https://www.youtube-nocookie.com/embed/x", 5) == "https://www.youtube-nocookie.com/embed/x?start=5"
    assert with_start("https://player.vimeo.com/video/1", 65) == "https://player.vimeo.com/video/1#t=65s"
    assert with_start("https://player.vimeo.com/video/1#t=3s", 65) == "https://player.vimeo.com/video/1#t=65s"
    assert with_start("https://player.vimeo.com/video/1", 0) == "https://player.vimeo.com/video/1"


def test_youtube_id_and_start():
    url, notes = vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="00:01:05"/>')
    assert url == "https://www.youtube.com/embed/AbCdEfGhIjK?start=65" and notes == []
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="00:00:00"/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK"
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="01:00:01.5"/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK?start=3601"


def test_bad_youtube_id_falls_back_to_html5_sources():
    url, _ = vid('<video youtube_id_1_0="too-short" html5_sources="[&quot;https://example.org/a.mp4&quot;, &quot;https://youtu.be/AbCdEfGhIjK&quot;]"/>')
    assert url == "https://www.youtube.com/embed/AbCdEfGhIjK"
    assert vid('<video youtube_id_1_0="" html5_sources="[&quot;https://example.org/a.mp4&quot;]"/>') == (None, [])
    assert vid('<video><source src="https://vimeo.com/42"/></video>')[0] == "https://player.vimeo.com/video/42"
    assert vid('<video html5_sources="not json"><source src="https://vimeo.com/7"/></video>')[0] == "https://player.vimeo.com/video/7"
    assert vid('<video html5_sources="{&quot;a&quot;: 1}"/>') == (None, [])


def test_html5_http_and_protocol_relative_become_https():
    assert vid('<video html5_sources="[&quot;//www.youtube.com/watch?v=abc&quot;]"/>')[0] == "https://www.youtube.com/embed/abc"
    assert vid('<video html5_sources="[&quot;http://www.youtube.com/embed/abc?rel=0&quot;]"/>')[0] == "https://www.youtube.com/embed/abc?rel=0"
    assert vid('<video html5_sources="[&quot;HTTP://player.vimeo.com/video/9&quot;]"/>')[0] == "https://player.vimeo.com/video/9"


def test_vimeo_start_fragment():
    url, _ = vid('<video html5_sources="[&quot;https://vimeo.com/123456789&quot;]" start_time="00:01:05"/>')
    assert url == "https://player.vimeo.com/video/123456789#t=65s"


def test_player_vimeo_passthrough_counts():
    assert vid('<video html5_sources="[&quot;https://player.vimeo.com/video/555&quot;]"/>')[0] == "https://player.vimeo.com/video/555"


def test_dropped_features_listed():
    _, notes = vid('<video youtube_id_1_0="AbCdEfGhIjK" end_time="00:05:00" download_video="true" sub="s">'
                   '<transcript language="en" src="t.srt"/></video>')
    assert notes == ["Video end times dropped", "Video transcripts dropped", "Video download settings dropped"]
    for xml in ('<video youtube_id_1_0="AbCdEfGhIjK" transcripts="{&quot;en&quot;: &quot;a.srt&quot;}"/>',
                '<video youtube_id_1_0="AbCdEfGhIjK" download_track="true"/>'):
        assert len(vid(xml)[1]) == 1
    _, notes = vid('<video youtube_id_1_0="AbCdEfGhIjK" end_time="00:00:00" download_video="false" sub="" transcripts="{}"/>')
    assert notes == []


def test_fixture_videos():
    root = Path(__file__).parent / "fixtures/olx/course/video"
    assert vid((root / "v_intro.xml").read_text()) == ("https://www.youtube.com/embed/AbCdEfGhIjK?start=65",
                                                        ["Video end times dropped", "Video transcripts dropped", "Video download settings dropped"])
    assert vid((root / "v_vimeo.xml").read_text()) == ("https://player.vimeo.com/video/123456789", [])


def test_unreadable_start_time_noted():
    url, notes = vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="soon"/>')
    assert url == "https://www.youtube.com/embed/AbCdEfGhIjK" and notes == ["Video start times that could not be read were dropped"]


def kind(html):
    return classify_html(parse_html(html))


def test_classify_graasta_canonical_and_normalised():
    for src in ("https://graasta.com/apps/sine-demo/", "https://graasta.com/apps/sine-demo", "//graasta.com/apps/sine-demo/",
                "http://graasta.com/apps/sine-demo/", "https://WWW.Graasta.com/apps/sine-demo/", "HTTPS://graasta.com/apps/sine-demo/",
                "\x0bhttps://graasta.com/apps/sine-demo/ "):
        assert kind(f'<p>&nbsp;</p><iframe src="{src}" width="100%">fallback text</iframe><p> </p>') == PageKind("graasta", "sine-demo"), src
    fixture = Path(__file__).parent / "fixtures/olx/course/html/h_sine.html"
    assert kind(fixture.read_text()) == PageKind("graasta", "sine-demo")


@pytest.mark.parametrize("src", ["https://graasta.com/apps/sine-demo/?x=1", "https://graasta.com/apps/sine-demo/#a",
                                 "https://graasta.com/apps/sine-demo/more", "https://graasta.com/apps/Sine-Demo/",
                                 "https://graasta.com:443/apps/sine-demo/", "https://u@graasta.com/apps/sine-demo/",
                                 "https://graasta.com.evil.org/apps/sine-demo/", "https://www.www.graasta.com/apps/x/",
                                 "ftp://graasta.com/apps/x/", "https:graasta.com/apps/x/", ""])
def test_classify_graasta_with_query_is_page(src):
    assert kind(f'<iframe src="{src}"></iframe>') == PageKind("page", None)


def test_classify_graasta_with_other_content_is_page():
    g = '<iframe src="https://graasta.com/apps/sine-demo/"></iframe>'
    for html in (f"<p>Try it:</p>{g}", f"{g}{g}", f'{g}<img src="/static/i.png">', f"{g}<hr>", f"<h2>x</h2>{g}",
                 f'<a href="https://e.com">see</a>{g}', f'{g}<iframe src="https://www.youtube.com/embed/x"></iframe>'):
        assert kind(html) == PageKind("page", None), html
    for html in (f"<div><p>{g}</p></div>", f"<script>x()</script><style>p{{}}</style>{g}<br>", f"<!-- note -->{g}"):
        assert kind(html) == PageKind("graasta", "sine-demo"), html


def test_classify_video_iframe_embed_forms():
    cases = {
        "https://www.youtube.com/embed/AbCdEfGhIjK": "https://www.youtube.com/embed/AbCdEfGhIjK",
        "//www.youtube-nocookie.com/embed/AbCdEfGhIjK?rel=0": "https://www.youtube-nocookie.com/embed/AbCdEfGhIjK?rel=0",
        "http://player.vimeo.com/video/42": "https://player.vimeo.com/video/42",
        "HTTPS://www.youtube.com/embed/x": "https://www.youtube.com/embed/x",
        "https://www.youtube.com/watch?v=abc&t=5": "https://www.youtube.com/embed/abc?start=5",
        "//vimeo.com/42": "https://player.vimeo.com/video/42",
    }
    for src, url in cases.items():
        assert kind(f'<p><iframe src="{src}" allowfullscreen></iframe></p>') == PageKind("video", url), src
    assert kind('<iframe src="https://www.youtube.com/playlist?list=PL1"></iframe>') == PageKind("page", None)
    assert kind('<iframe src="https://www.youtube-nocookie.com/watch?v=x"></iframe>') == PageKind("page", None)
    fixture = Path(__file__).parent / "fixtures/olx/course/html/h_embed.html"
    assert kind(fixture.read_text()) == PageKind("video", "https://www.youtube.com/embed/AbCdEfGhIjK")


def test_classify_plain_pages():
    assert kind("<p>Hello</p>") == PageKind("page", None)
    assert kind("") == PageKind("page", None)
    assert kind('<iframe src="https://maps.example.com/e"></iframe>') == PageKind("page", None)
    deep = "<div>" * 110 + '<iframe src="https://graasta.com/apps/sine-demo/"></iframe>' + "</div>" * 110
    assert kind(deep) == PageKind("page", None)          # a too-deep frame is only a marker, not content


# review round 1


def test_huge_numbers_and_deep_json_do_not_crash():
    assert embed_url("https://youtu.be/abc?t=" + "9" * 5000) == "https://www.youtube.com/embed/abc"
    assert kind('<iframe src="https://youtu.be/abc?t=' + "9" * 5000 + '"></iframe>') == PageKind("video", "https://www.youtube.com/embed/abc")
    url, notes = vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="' + "9" * 5000 + ':00:00"/>')
    assert url == "https://www.youtube.com/embed/AbCdEfGhIjK" and notes == ["Video start times that could not be read were dropped"]
    assert vid('<video html5_sources="' + "[" * 200_000 + '"/>') == (None, [])


def test_kept_embed_addresses_must_be_plain():
    for src in ("https://evil.com\\@www.youtube.com/embed/x", "https://evil.com\\@player.vimeo.com/video/1",
                "https://evil.com\\@www.youtube-nocookie.com/embed/x", "https://www.youtube.com:99999/embed/x",
                "https://www.youtube.com:443/embed/x", "https://u:p@www.youtube.com/embed/x", "https://u@player.vimeo.com/video/1"):
        assert kind(f'<iframe src="{src}"></iframe>') == PageKind("page", None), src
        assert embed_url(src) is None, src
        assert vid(f'<video html5_sources="[&quot;{src}&quot;]"/>') == (None, []), src
    assert kind('<iframe src="https://evil.com\\@youtu.be/abc"></iframe>') == PageKind("video", "https://www.youtube.com/embed/abc")


def test_overlong_video_address_is_skipped():
    long = "https://www.youtube.com/embed/x?" + "a=1&" * 130
    assert len(long) > 500
    esc = long.replace("&", "&amp;")
    assert vid(f'<video html5_sources="[&quot;{esc}&quot;]"/>') == (None, [])
    assert kind(f'<iframe src="{esc}"></iframe>') == PageKind("page", None)


def test_old_youtube_attribute_fallback():
    assert vid('<video youtube="0.75:aaaaaaaaaaa,1.00:AbCdEfGhIjK,1.25:bbbbbbbbbbb"/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK"
    assert vid('<video youtube_id_1_0="bad" youtube="1.00:AbCdEfGhIjK"/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK"
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" youtube="1.00:ZZZZZZZZZZZ"/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK"
    assert vid('<video youtube="1.00:short"/>') == (None, [])


def test_ascii_digits_and_dot_segments_only():
    assert embed_url("https://youtu.be/abc?t=٤٢") == "https://www.youtube.com/embed/abc"
    assert embed_url("https://player.vimeo.com/video/٤٢") is None
    assert embed_url("https://vimeo.com/٤٢") is None
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="٠٠:٠١:٠٥"/>')[1] == ["Video start times that could not be read were dropped"]
    for url in ("https://youtu.be/shorts/../x", "https://vimeo.com/12/../34", "https://www.youtube.com/shorts/./x", "https://youtu.be/./x"):
        assert embed_url(url) is None, url


def test_edges_trimmed_like_addresses():
    assert to_https("\x00https://e.com\x01") == "https://e.com"
    assert kind('<iframe src="\x01https://graasta.com/apps/x/"></iframe>') == PageKind("graasta", "x")
    assert kind('<iframe src="https://graasta.com/apps/\tx/"></iframe>') == PageKind("graasta", "x")
    assert kind('<iframe src="\xa0https://graasta.com/apps/x/"></iframe>') == PageKind("page", None)
    assert embed_url("https://youtu.be/abc?t=007\x85") == "https://www.youtube.com/embed/abc"
    assert vid('<video><source src="https://you&#9;tu.be/abc"/></video>')[0] == "https://www.youtube.com/embed/abc"


def test_zero_width_characters_beside_the_frame():
    g = '<iframe src="https://graasta.com/apps/x/"></iframe>'
    for ch in ("​", "﻿", "⁠", "&shy;", "‌‍"):
        assert kind(f"<p>{ch}</p>{g}") == PageKind("graasta", "x"), repr(ch)


def test_zero_start_in_other_forms_is_quiet():
    for start in ("0", "0.0", "00:00:00.0"):
        assert vid(f'<video youtube_id_1_0="AbCdEfGhIjK" start_time="{start}"/>') == ("https://www.youtube.com/embed/AbCdEfGhIjK", [])


def test_with_start_on_bad_address_is_unchanged():
    assert with_start("https://[bad/x", 5) == "https://[bad/x"


def test_classify_pins():
    assert kind('<iframe src="youtu.be/abc"></iframe>') == PageKind("page", None)
    assert kind('<iframe src="https://[bad/embed/x"></iframe>') == PageKind("page", None)
    g = '<iframe src="https://graasta.com/apps/x/"></iframe>'
    assert kind(f"<head><title>T</title></head>{g}") == PageKind("graasta", "x")
    for el in ("<video></video>", "<audio></audio>", "<object></object>", "<embed>", "<input>", "<select></select>",
               "<textarea></textarea>", "<button></button>", "<svg></svg>", "<canvas></canvas>", "<math></math>", "<picture></picture>"):
        assert kind(el + g) == PageKind("page", None), el
    assert kind('<iframe src="https://youtube-nocookie.com/embed/AbCdEfGhIjK"></iframe>') == \
        PageKind("video", "https://youtube-nocookie.com/embed/AbCdEfGhIjK")
    assert kind('<iframe src="https://www.youtube-nocookie.com/v/AbCdEfGhIjK"></iframe>') == PageKind("page", None)


def test_embed_url_pins():
    assert embed_url("YOUTU.BE/x") == "https://www.youtube.com/embed/x"
    assert embed_url("https://youtu.be/abc?t=007") == "https://www.youtube.com/embed/abc?start=7"
    assert embed_url("https://WWW.YouTube.com/watch?v=x") == "https://www.youtube.com/embed/x"
    assert embed_url("https://www.youtube.com/watchlater?v=x") is None
    assert embed_url("https://youtu.be/id/extra") == "https://www.youtube.com/embed/id"
    assert embed_url("https://player.vimeo.com/video/1/") == "https://player.vimeo.com/video/1/"
    assert embed_url("https://player.vimeo.com/video/1/x") is None


def test_video_component_pins():
    assert vid('<video html5_sources="[&quot;https://vimeo.com/1&quot;, &quot;https://vimeo.com/2&quot;]"/>')[0] == "https://player.vimeo.com/video/1"
    assert vid('<video html5_sources="[&quot;https://vimeo.com/1&quot;]"><source src="https://vimeo.com/2"/></video>')[0] == \
        "https://player.vimeo.com/video/1"
    assert vid('<video html5_sources="[5, &quot;https://vimeo.com/3&quot;]"/>')[0] == "https://player.vimeo.com/video/3"
    assert vid('<video youtube_id_1_0="AbCdEfGhIjKL"/>') == (None, [])
    assert vid('<video youtube_id_1_0="AbCdEfGhIj!"/>') == (None, [])
    assert vid('<video youtube_id_1_0=" AbCdEfGhIjK " start_time=" 00:01:05 "/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK?start=65"
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" start_time="0:1:5" end_time="00:00:00.0"/>') == \
        ("https://www.youtube.com/embed/AbCdEfGhIjK?start=65", [])
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" sub="s"/>')[1] == ["Video transcripts dropped"]
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK"><transcript src="t.srt"/></video>')[1] == ["Video transcripts dropped"]
    assert vid('<video youtube_id_1_0="AbCdEfGhIjK" download_video="True"/>')[1] == ["Video download settings dropped"]


# review round 2 pins


def _embed_of_length(n):
    base = "https://www.youtube.com/embed/x?a="
    return base + "b" * (n - len(base))


def test_video_url_cap_boundary():
    ok, over = _embed_of_length(500), _embed_of_length(501)
    assert len(ok) == 500 and len(over) == 501
    assert vid(f'<video html5_sources="[&quot;{ok}&quot;]"/>')[0] == ok
    assert vid(f'<video html5_sources="[&quot;{over}&quot;]"/>') == (None, [])
    assert kind(f'<iframe src="{ok}"></iframe>') == PageKind("video", ok)
    assert kind(f'<iframe src="{over}"></iframe>') == PageKind("page", None)


def test_kept_address_with_upper_case_host():
    assert kind('<iframe src="https://WWW.YouTube.com/embed/x"></iframe>') == PageKind("video", "https://WWW.YouTube.com/embed/x")
    assert embed_url("https://Player.Vimeo.com/video/1") == "https://Player.Vimeo.com/video/1"


def test_nocookie_needs_a_plain_id():
    for src in ("https://www.youtube-nocookie.com/embed/", "https://www.youtube-nocookie.com/embed/a%20b"):
        assert kind(f'<iframe src="{src}"></iframe>') == PageKind("page", None), src


def test_old_youtube_attribute_speed_forms():
    for attr in ("1:AbCdEfGhIjK", "1.0:AbCdEfGhIjK", " 0.75:aaaaaaaaaaa , 1.00 : AbCdEfGhIjK "):
        assert vid(f'<video youtube="{attr}"/>')[0] == "https://www.youtube.com/embed/AbCdEfGhIjK", attr


def test_non_list_sources_are_ignored():
    for value in ("5", "null", "&quot;https://vimeo.com/1&quot;"):
        assert vid(f'<video html5_sources="{value}"/>') == (None, []), value


# codex round 1


def test_lone_surrogate_source_is_rejected():
    xml = '<video html5_sources=\'["https://www.youtube.com/embed/x?q=\\ud800", "https://vimeo.com/4"]\' start_time="00:00:01"/>'
    assert vid(xml)[0] == "https://player.vimeo.com/video/4#t=1s"
    assert vid('<video html5_sources=\'["https://www.youtube.com/embed/x?q=\\ud800"]\'/>') == (None, [])
    assert embed_url("https://youtu.be/abc?x=\ud800") is None


def test_srcdoc_frame_is_a_page():
    for attrs in ('srcdoc="<p>Required</p>"', 'srcdoc=""', "srcdoc"):
        for src in ("https://graasta.com/apps/x/", "https://www.youtube.com/embed/x"):
            assert kind(f'<iframe src="{src}" {attrs}></iframe>') == PageKind("page", None), (src, attrs)


def test_frame_content_is_raw_text():
    assert kind('<iframe src="https://graasta.com/apps/x/"><script></iframe><p>Keep me</p></script>') == PageKind("page", None)


def test_low_surrogate_source_is_rejected():
    assert embed_url("https://youtu.be/abc?x=\udfff") is None
    assert vid('<video html5_sources=\'["https://vimeo.com/1#\\udc00"]\'/>') == (None, [])


# codex round 2


def test_control_characters_inside_a_source_are_rejected():
    for ch in ("\\u0000", "\\u0001", "\\u001f", "\\u007f"):
        xml = f'<video html5_sources=\'["https://www.youtube.com/embed/x?q=a{ch}b", "https://vimeo.com/5"]\'/>'
        assert vid(xml)[0] == "https://player.vimeo.com/video/5", ch
    assert embed_url("https://player.vimeo.com/video/1?h=a\x00b") is None


def test_head_content_and_templates():
    g = '<iframe src="https://graasta.com/apps/x/"></iframe>'
    assert kind(f"<head><p>Keep me</p></head>{g}") == PageKind("page", None)
    assert kind(f"<head>Loose</head>{g}") == PageKind("page", None)
    assert kind(f"<head><title>T</title><meta charset='utf-8'></head>{g}") == PageKind("graasta", "x")
    assert kind(f"<template><p>Invisible</p></template>{g}") == PageKind("graasta", "x")


def test_nocookie_frame_with_control_characters_is_a_page():
    for ch in ("\x01", "\x7f", "\x1f"):
        assert kind(f'<iframe src="https://www.youtube-nocookie.com/embed/abc?x={ch}y"></iframe>') == PageKind("page", None), repr(ch)
        assert kind(f'<iframe src="https://www.youtube-nocookie.com/embed/abc#a{ch}b"></iframe>') == PageKind("page", None), repr(ch)
    assert kind('<iframe src="https://www.youtube-nocookie.com/embed/abc#\x7f"></iframe>') == PageKind("page", None)
    assert kind('<iframe src="https://www.youtube-nocookie.com/embed/abc#\x01"></iframe>') == \
        PageKind("video", "https://www.youtube-nocookie.com/embed/abc#")     # edge controls are trimmed like any address


def test_head_shapes_around_a_frame():
    g = '<iframe src="https://graasta.com/apps/x/"></iframe>'
    assert kind(f"<head><head><p>Keep me</p></head>{g}") == PageKind("page", None)
    assert kind(f"<head><bgsound src='a.mid'><p>Keep me</p></head>{g}") == PageKind("page", None)
    assert kind(f"<head>\n <meta charset='utf-8'><link rel=icon href=f.png><style>p{{}}</style><script>x()</script>"
                f"<template><p>t</p></template><noscript>n</noscript><noframes>f</noframes><base href='/'><title>T</title></head>{g}") \
        == PageKind("graasta", "x")
    assert kind(f"<html><title>My page</title><body>{g}</body></html>") == PageKind("graasta", "x")


def test_self_closing_visible_tag_closes_head():
    g = '<iframe src="https://graasta.com/apps/x/"></iframe>'
    assert kind(f'<head><img src="/static/f.png"/></head>{g}') == PageKind("page", None)


# codex round 3


def test_encoded_dot_segments_are_rejected():
    for url in ("https://youtu.be/dQw4w9WgXcQ/%2e%2e/M7lc1UVf-VE", "https://youtu.be/a/%2E%2e/b", "https://youtu.be/a/.%2e/b",
                "https://youtu.be/%2e/b", "https://vimeo.com/12/%2e%2e/34", "https://www.youtube.com/shorts/a/%2e%2E/b",
                "https://www.youtube.com/embed/ab/%2e%2e/%2E./watch?v=zz"):
        assert embed_url(url) is None, url
    assert kind('<iframe src="https://www.youtube-nocookie.com/embed/ab/../../watch?v=zz"></iframe>') == PageKind("page", None)
    assert kind('<iframe src="https://www.youtube-nocookie.com/embed/ab/%2e%2e/x"></iframe>') == PageKind("page", None)
    assert embed_url("https://youtu.be/a%2eb") is None                      # not a segment, but not a plain id either


def test_cdata_beside_a_frame_is_visible():
    assert kind('<iframe src="https://graasta.com/apps/x/"></iframe><![CDATA[<p>Keep me</p>]]>') == PageKind("page", None)


def test_single_encoded_dot_segment_is_rejected():
    assert embed_url("https://www.youtube.com/embed/abc/%2e/x") is None


# codex round 4


def test_noscript_beside_a_frame():
    g = '<iframe src="https://graasta.com/apps/x/"></iframe>'
    assert kind(f"{g}<noscript><style></noscript><p>Keep me</p>") == PageKind("page", None)
    assert kind(f"{g}<noscript><p>Enable JavaScript</p></noscript>") == PageKind("graasta", "x")


def test_backslash_dot_segments_are_rejected():
    assert kind('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ/..\\..\\watch?v=M7lc1UVf-VE"></iframe>') == PageKind("page", None)
    assert embed_url("https://youtu.be/a\\..\\b") is None
    assert embed_url("https://youtu.be/embed/x\\%2e%2e\\%2e%2e\\y") is None


def test_self_closing_frame_reads_raw_text():
    assert kind('<iframe src="https://graasta.com/apps/x/"/><script></iframe><p>Keep me</p>') == PageKind("page", None)
    assert kind('<iframe src="https://graasta.com/apps/x/"/><p>fallback</p></iframe>') == PageKind("graasta", "x")
