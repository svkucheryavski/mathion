"""Bounded-type inputs return 422, never a 500 DataError (Postgres §7b).

Postgres enforces the VARCHAR(n) / NUMERIC(p,s) / INTEGER column bounds that
were previously unenforced. The write schemas now carry matching bounds, so
over-bound input is rejected at request validation (HTTP 422) instead of
reaching the driver and raising a 500 DataError. These tests pin that contract
at representative create AND update endpoints, plus the sanitize_filename
truncation that keeps derived upload names within the String(255) column.
"""
from mathion.assets import sanitize_filename


# --- sanitize_filename truncation (unit) --------------------------------------

def test_sanitize_filename_truncates_to_255_preserving_extension():
    result = sanitize_filename("a" * 400 + ".PDF")
    assert len(result) == 255
    assert result.endswith(".pdf")
    assert result == "a" * 251 + ".pdf"


def test_sanitize_filename_short_name_unchanged():
    assert sanitize_filename("report.pdf") == "report.pdf"


# --- helpers ------------------------------------------------------------------

def _quiz_item(admin_client, slug):
    """Create an unpublished course -> version -> block -> sequence -> quiz item.

    Item/question authoring requires the version in its 'created' state, so this
    deliberately does NOT publish. Returns (course, version, seq, item) dicts.
    """
    course = admin_client.post(
        "/api/courses", json={"slug": slug, "name": "B", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}
    ).json()
    seq = admin_client.post(
        f"/api/blocks/{block['id']}/sequences", json={"title": "S"}
    ).json()
    item = admin_client.post(
        f"/api/sequences/{seq['id']}/items", json={"title": "Quiz", "type": "quiz"}
    ).json()
    return course, version, seq, item


def _published_run(admin_client, seed_publishable_version, groups_enabled=False):
    course, _ = seed_publishable_version()
    run = admin_client.post(
        f"/api/courses/{course['id']}/runs",
        json={"title": "R", "start_date": "2026-01-01", "end_date": "2026-06-01",
              "groups_enabled": groups_enabled},
    ).json()
    admin_client.post(f"/api/runs/{run['id']}/teachers", json={"email": "teach@example.com"})
    assert admin_client.post(f"/api/runs/{run['id']}/publish").status_code == 200
    return run


# --- email: String(254) via list-item bound (course enroll-batch) -------------

def test_enroll_batch_rejects_oversized_email(admin_client, seed_publishable_version):
    course, _ = seed_publishable_version()
    long_email = "a" * 250 + "@x.com"  # 256 chars > 254
    r = admin_client.post(
        f"/api/courses/{course['id']}/enroll-batch", json={"emails": [long_email]}
    )
    assert r.status_code == 422


# --- run roster batch: String(200) name / String(80) group --------------------

def test_run_batch_rejects_oversized_group(admin_client, seed_publishable_version):
    run = _published_run(admin_client, seed_publishable_version, groups_enabled=True)
    r = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [{"name": "Al", "email": "al@example.com", "group": "g" * 81}]},
    )
    assert r.status_code == 422


def test_run_batch_rejects_oversized_name(admin_client, seed_publishable_version):
    run = _published_run(admin_client, seed_publishable_version)
    r = admin_client.post(
        f"/api/runs/{run['id']}/students/batch",
        json={"rows": [{"name": "n" * 201, "email": "n@example.com"}]},
    )
    assert r.status_code == 422


# --- question create: String(500) text / NUMERIC(20,10) / precision int -------

def test_question_create_rejects_oversized_correct_text(admin_client):
    _, _, _, item = _quiz_item(admin_client, "qct")
    r = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "text_answer", "correct_text": "x" * 501},
    )
    assert r.status_code == 422


def test_question_create_rejects_correct_numeric_over_ten_integer_digits(admin_client):
    # NUMERIC(20,10) caps the integer part at precision-scale = 10 digits; 11
    # digits overflows Postgres. Pydantic's max_digits/decimal_places rejects it
    # first (decimal_whole_digits), so this never reaches the driver.
    _, _, _, item = _quiz_item(admin_client, "qcn")
    r = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "numeric_answer", "correct_numeric": "12345678901"},
    )
    assert r.status_code == 422


def test_question_create_rejects_out_of_range_precision(admin_client):
    _, _, _, item = _quiz_item(admin_client, "qcp")
    r = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "numeric_answer",
              "correct_numeric": "3", "precision": 11},
    )
    assert r.status_code == 422


# --- question update: same String(500) bound on the PATCH schema --------------

def test_question_update_rejects_oversized_correct_text(admin_client):
    _, _, _, item = _quiz_item(admin_client, "qut")
    q = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "text_answer", "correct_text": "ok"},
    ).json()
    r = admin_client.patch(
        f"/api/questions/{q['id']}", json={"correct_text": "x" * 501}
    )
    assert r.status_code == 422


def test_question_update_rejects_correct_numeric_over_ten_integer_digits(admin_client):
    # The PATCH schema (QuestionUpdate) must carry the same NUMERIC(20,10) bound
    # as create; without it, this over-bound update would 500 on Postgres.
    _, _, _, item = _quiz_item(admin_client, "qun")
    q = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "numeric_answer", "correct_numeric": "3", "precision": 0},
    ).json()
    r = admin_client.patch(
        f"/api/questions/{q['id']}", json={"correct_numeric": "12345678901"}
    )
    assert r.status_code == 422


def test_question_update_rejects_out_of_range_precision(admin_client):
    _, _, _, item = _quiz_item(admin_client, "qup")
    q = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "numeric_answer", "correct_numeric": "3", "precision": 0},
    ).json()
    r = admin_client.patch(
        f"/api/questions/{q['id']}", json={"precision": 11}
    )
    assert r.status_code == 422


# --- item create / update: String(500) video_url -----------------------------

def test_item_create_rejects_oversized_video_url(admin_client):
    _, _, seq, _ = _quiz_item(admin_client, "ivc")
    r = admin_client.post(
        f"/api/sequences/{seq['id']}/items",
        json={"title": "V", "type": "video", "video_url": "http://x.test/" + "a" * 500},
    )
    assert r.status_code == 422


def test_item_update_rejects_oversized_video_url(admin_client):
    _, _, _, item = _quiz_item(admin_client, "ivu")
    r = admin_client.patch(
        f"/api/items/{item['id']}",
        json={"video_url": "http://x.test/" + "a" * 500},
    )
    assert r.status_code == 422


# --- reorder: INTEGER (int4) upper bound on order -----------------------------

def test_question_reorder_rejects_out_of_int4_order(admin_client):
    _, _, _, item = _quiz_item(admin_client, "qro")
    q = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "single_choice"},
    ).json()
    r = admin_client.post(
        f"/api/items/{item['id']}/questions/reorder",
        json={"order": [{"id": q["id"], "order": 2147483648}]},  # int4 max + 1
    )
    assert r.status_code == 422
