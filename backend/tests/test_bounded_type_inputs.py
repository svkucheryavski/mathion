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


# --- Finding 1: normalized batch/single email overflowing VARCHAR(254) --------
#
# A raw email <=254 codepoints can expand PAST 254 under .lower() (some Unicode
# lowercases to more codepoints: 'İ' U+0130 -> 'i̇' = 2 codepoints). The write
# schema must normalize THEN bound, so the overflow is rejected at validation
# (422) instead of reaching users.email VARCHAR(254) as a driver DataError (500).

def test_enroll_batch_rejects_email_overflowing_after_normalization(
    admin_client, seed_publishable_version
):
    course, _ = seed_publishable_version()
    overflowing = "İ" * 200  # 200 raw chars (<=254); 400 codepoints after .lower()
    r = admin_client.post(
        f"/api/courses/{course['id']}/enroll-batch", json={"emails": [overflowing]}
    )
    assert r.status_code == 422


def test_enroll_single_rejects_email_overflowing_after_normalization(
    admin_client, seed_publishable_version
):
    course, _ = seed_publishable_version()
    r = admin_client.post(
        f"/api/courses/{course['id']}/enroll", json={"email": "İ" * 200}
    )
    assert r.status_code == 422


# --- Finding 2: derived next_order overflow when max order == int4 max ---------
#
# A legal reorder can pin an existing child to order 2147483647 (int4 max). The
# next create computes next_order = max + 1, which overflows the int4 `order`
# column -> DataError -> 500. Each create site must guard: 409 when exhausted.

INT4_MAX = 2147483647


def test_block_create_409_when_order_exhausted_via_reorder(admin_client):
    """Site blocks.py:74 — driven end-to-end through the real reorder API."""
    course = admin_client.post(
        "/api/courses", json={"slug": "blk-exhaust", "name": "B", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "First", "info": ""}
    ).json()
    # Legal reorder pins the sole block to int4 max (allowed: ReorderItem le=int4 max).
    r = admin_client.post(
        f"/api/versions/{version['id']}/blocks/reorder",
        json={"order": [{"id": block["id"], "order": INT4_MAX}]},
    )
    assert r.status_code == 200
    r = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "Second", "info": ""}
    )
    assert r.status_code == 409


def test_sequence_create_409_when_order_exhausted(admin_client, db):
    """Site blocks.py:265."""
    from mathion.models import Sequence

    course = admin_client.post(
        "/api/courses", json={"slug": "seq-exhaust", "name": "S", "description": ""}
    ).json()
    version = admin_client.post(
        f"/api/courses/{course['id']}/versions", json={"info_md": ""}
    ).json()
    block = admin_client.post(
        f"/api/versions/{version['id']}/blocks", json={"title": "B", "info": ""}
    ).json()
    seq = admin_client.post(
        f"/api/blocks/{block['id']}/sequences", json={"title": "First"}
    ).json()
    db.get(Sequence, seq["id"]).order = INT4_MAX
    db.commit()
    r = admin_client.post(
        f"/api/blocks/{block['id']}/sequences", json={"title": "Second"}
    )
    assert r.status_code == 409


def test_item_create_409_when_order_exhausted(admin_client, db):
    """Site items.py:72."""
    from mathion.models import Item

    _, _, seq, item = _quiz_item(admin_client, "item-exhaust")
    db.get(Item, item["id"]).order = INT4_MAX
    db.commit()
    r = admin_client.post(
        f"/api/sequences/{seq['id']}/items", json={"title": "Second", "type": "quiz"}
    )
    assert r.status_code == 409


def test_question_create_409_when_order_exhausted(admin_client, db):
    """Site questions.py:56."""
    from mathion.models import Question

    _, _, _, item = _quiz_item(admin_client, "q-exhaust")
    q = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "single_choice"},
    ).json()
    db.get(Question, q["id"]).order = INT4_MAX
    db.commit()
    r = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q2", "type": "single_choice"},
    )
    assert r.status_code == 409


def test_option_create_409_when_order_exhausted(admin_client, db):
    """Site questions.py:175."""
    from mathion.models import AnswerOption

    _, _, _, item = _quiz_item(admin_client, "opt-exhaust")
    q = admin_client.post(
        f"/api/items/{item['id']}/questions",
        json={"text_md": "q", "type": "single_choice"},
    ).json()
    opt = admin_client.post(
        f"/api/questions/{q['id']}/options", json={"text": "A", "is_correct": True}
    ).json()
    db.get(AnswerOption, opt["id"]).order = INT4_MAX
    db.commit()
    r = admin_client.post(
        f"/api/questions/{q['id']}/options", json={"text": "B", "is_correct": False}
    )
    assert r.status_code == 409


# --- Finding 1 (siblings): run-teacher / run-student write schemas ------------
#
# The enroll schemas above route through schemas._normalize_email (normalize THEN
# bound). Three sibling write schemas feed the SAME users.email VARCHAR(254)
# insert via get_or_create_user (run_teachers.py, run_roster.py) and must reject
# the post-.lower() overflow at validation too, not 500 on the driver. These are
# deterministic schema-level unit tests: `"İ" * 200` is 200 raw chars (<=254) but
# 400 codepoints after .lower(). Before _normalize_email each schema constructed
# a 400-char email; now each raises ValidationError.

def test_run_teacher_create_rejects_email_overflowing_after_normalization():
    import pytest
    from pydantic import ValidationError
    from mathion.schemas import RunTeacherCreate

    with pytest.raises(ValidationError):
        RunTeacherCreate(email="İ" * 200)  # 200 raw <=254; 400 codepoints after .lower()


def test_run_student_create_rejects_email_overflowing_after_normalization():
    import pytest
    from pydantic import ValidationError
    from mathion.schemas import RunStudentCreate

    with pytest.raises(ValidationError):
        RunStudentCreate(email="İ" * 200)


def test_run_student_batch_row_rejects_email_overflowing_after_normalization():
    import pytest
    from pydantic import ValidationError
    from mathion.schemas import RunStudentBatchRow

    with pytest.raises(ValidationError):
        RunStudentBatchRow(email="İ" * 200)
