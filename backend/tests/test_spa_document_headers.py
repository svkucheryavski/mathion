from mathion.main import _panel_cache_headers


def test_panel_paths_get_no_store():
    assert _panel_cache_headers("superuser/abc123") == {"Cache-Control": "no-store"}
    assert _panel_cache_headers("superuser") == {"Cache-Control": "no-store"}


def test_non_panel_paths_get_no_headers():
    assert _panel_cache_headers("courses") is None
    assert _panel_cache_headers("") is None
    assert _panel_cache_headers("superuserfoo") is None  # not a panel path
