from mathion.assets import sanitize_filename, validate_extension, get_mime_type


def test_sanitize_lowercase():
    assert sanitize_filename("MyFile.PDF") == "myfile.pdf"


def test_sanitize_spaces_to_hyphens():
    assert sanitize_filename("my file name.png") == "my-file-name.png"


def test_sanitize_special_chars_removed():
    assert sanitize_filename("hello@world#1.jpg") == "helloworld1.jpg"


def test_sanitize_unicode_normalized():
    assert sanitize_filename("cafe\u0301.pdf") == "cafe.pdf"


def test_sanitize_multiple_hyphens_collapsed():
    assert sanitize_filename("a---b.png") == "a-b.png"


def test_sanitize_leading_trailing_hyphens_stripped():
    assert sanitize_filename("-test-.pdf") == "test.pdf"


def test_sanitize_underscores_to_hyphens():
    assert sanitize_filename("my_file_name.png") == "my-file-name.png"


def test_sanitize_empty_base_uses_fallback():
    assert sanitize_filename("!!!.png") == "file.png"


def test_sanitize_no_extension():
    assert sanitize_filename("README") == "readme"


def test_validate_extension_allowed():
    assert validate_extension("diagram.png") == "png"
    assert validate_extension("slides.PDF") == "pdf"
    assert validate_extension("data.csv") == "csv"
    assert validate_extension("app.js") == "js"
    assert validate_extension("analysis.r") == "r"
    assert validate_extension("script.py") == "py"
    assert validate_extension("code.m") == "m"


def test_validate_extension_blocked():
    assert validate_extension("hack.svg") is None
    assert validate_extension("virus.exe") is None
    assert validate_extension("page.html") is None
    assert validate_extension("noext") is None


def test_get_mime_type():
    assert get_mime_type("png") == "image/png"
    assert get_mime_type("jpg") == "image/jpeg"
    assert get_mime_type("pdf") == "application/pdf"
    assert get_mime_type("js") == "application/javascript"
    assert get_mime_type("unknown") == "application/octet-stream"


def test_looks_like_pdf():
    from mathion.assets import looks_like_pdf
    assert looks_like_pdf(b"%PDF-1.4 stuff") is True
    assert looks_like_pdf(b"%PDF") is False        # 4 bytes, no hyphen
    assert looks_like_pdf(b"MZ\x90\x00") is False
    assert looks_like_pdf(b"") is False
    assert looks_like_pdf(b"%PD") is False
