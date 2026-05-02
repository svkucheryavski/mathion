import pytest
from pydantic import ValidationError


def test_bulk_move_request_rejects_duplicates():
    from mathion.schemas import RunStudentBulkMoveRequest

    with pytest.raises(ValidationError) as ei:
        RunStudentBulkMoveRequest(user_ids=[1, 2, 1], group_id=7)
    assert "must not contain duplicates" in str(ei.value)


def test_bulk_move_request_rejects_empty_list():
    from mathion.schemas import RunStudentBulkMoveRequest

    with pytest.raises(ValidationError):
        RunStudentBulkMoveRequest(user_ids=[], group_id=7)


def test_bulk_move_request_rejects_oversize_list():
    from mathion.schemas import RunStudentBulkMoveRequest

    with pytest.raises(ValidationError):
        RunStudentBulkMoveRequest(user_ids=list(range(201)), group_id=7)


def test_bulk_move_request_accepts_null_group():
    from mathion.schemas import RunStudentBulkMoveRequest

    req = RunStudentBulkMoveRequest(user_ids=[1, 2, 3], group_id=None)
    assert req.group_id is None
    assert req.user_ids == [1, 2, 3]


def test_bulk_delete_request_rejects_duplicates():
    from mathion.schemas import RunStudentBulkDeleteRequest

    with pytest.raises(ValidationError) as ei:
        RunStudentBulkDeleteRequest(user_ids=[5, 5])
    assert "must not contain duplicates" in str(ei.value)


def test_bulk_delete_request_rejects_empty_list():
    from mathion.schemas import RunStudentBulkDeleteRequest

    with pytest.raises(ValidationError):
        RunStudentBulkDeleteRequest(user_ids=[])


def test_bulk_delete_request_rejects_oversize_list():
    from mathion.schemas import RunStudentBulkDeleteRequest

    with pytest.raises(ValidationError):
        RunStudentBulkDeleteRequest(user_ids=list(range(201)))


def test_bulk_move_result_row_shape():
    from mathion.schemas import RunStudentBulkMoveResultRow

    ok = RunStudentBulkMoveResultRow(user_id=12, status="ok", group_id=7)
    assert ok.detail is None
    err = RunStudentBulkMoveResultRow(user_id=34, status="error", detail="Group capacity reached")
    assert err.group_id is None


def test_bulk_delete_result_row_shape():
    from mathion.schemas import RunStudentBulkDeleteResultRow

    ok = RunStudentBulkDeleteResultRow(user_id=12, status="ok")
    assert ok.detail is None
    err = RunStudentBulkDeleteResultRow(user_id=34, status="error", detail="Student not in run")
    assert err.detail == "Student not in run"
