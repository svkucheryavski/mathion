"""Slice 5d D12 — a single-choice question ends with exactly one correct answer
under concurrency. create_option and update_option lock the parent QUESTION row
first (questions._lock_question), then call
advisory.interleave_hook("option_after_question_lock"). Locking only the option
rows would not cover inserts: two creates on an empty question have no rows to
lock.

Every other writer to a question's answer rows (option delete, option
reorder, question delete) takes the same question lock FIRST, and ancestor
deletes (item, sequence, block, version, course) reach the answer rows only
through the database's ON DELETE CASCADE, after the question row, so no writer
holds answer rows while waiting for the question row — that order would
deadlock against a correctness change.

The outcome asserts alone would not catch a lost lock (the parked worker has
written nothing yet, so an unlocked run serialises anyway): `_wait_blocked`
and `_option_rows_free` are the real guards.

Off-HTTP, as the other concurrency suites: thread bodies call the router
functions directly with per-thread NullPool sessions; handlers RAISE
HTTPException."""
import threading
import time

from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from mathion.api import advisory
from mathion.api.items import delete_item
from mathion.api.questions import (
    create_option, delete_option, delete_question, reorder_options, update_option,
)
from mathion.models import AnswerOption
from mathion.models_auth import User
from mathion.schemas import OptionCreate, OptionUpdate, ReorderItem, ReorderRequest
from tests.test_questions_api import _single_choice

HOOK = "option_after_question_lock"


def _pid(session):
    return session.execute(text("SELECT pg_backend_pid()")).scalar()


def _wait_blocked(probe, blocked_pid, by_pid, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        blocked = probe.execute(
            text("SELECT :b = ANY(pg_blocking_pids(:a))"), {"a": blocked_pid, "b": by_pid},
        ).scalar()
        probe.rollback()
        if blocked:
            return True
        time.sleep(0.05)
    return False


def _park_first(monkeypatch, request):
    """The first worker to reach the hook waits on `gate` (holding the question
    lock); every later arrival passes straight through. The gate is always
    released at teardown, so a failed assert leaves no parked worker behind."""
    gate, parked, mutex, taken = threading.Event(), threading.Event(), threading.Lock(), []
    real = advisory.interleave_hook

    def hook(label):
        if label == HOOK:
            with mutex:
                first = not taken
                taken.append(1)
            if first:
                parked.set()
                gate.wait(timeout=10)
        return real(label)

    monkeypatch.setattr(advisory, "interleave_hook", hook)
    request.addfinalizer(gate.set)
    return gate, parked


def _admin(session):
    return session.execute(select(User).where(User.email == "admin@example.com")).scalar_one()


def _run(fn, session, result, *args):
    try:
        fn(*args, db=session, user=_admin(session))
        result["ok"] = True
    except Exception as exc:  # noqa: BLE001 — the assertion reports it
        result["error"] = exc


def _option_rows_free(probe, qid):
    """True when no other transaction holds any of the question's answer rows."""
    try:
        probe.execute(
            text("SELECT id FROM answer_options WHERE question_id = :q FOR UPDATE NOWAIT"), {"q": qid},
        ).all()
        return True
    except OperationalError:
        return False
    finally:
        probe.rollback()


def _correct(session, qid):
    rows = session.execute(
        select(AnswerOption.text).where(AnswerOption.question_id == qid, AnswerOption.is_correct.is_(True))
    ).scalars().all()
    session.rollback()
    return sorted(rows)


def test_two_concurrent_moves_end_with_one_correct(concurrency, monkeypatch, request, admin_client):
    q, (_, b, c) = _single_choice(admin_client, True, False, False)
    gate, parked = _park_first(monkeypatch, request)
    sa, sb, probe = concurrency.make_sessions(3)
    pa, pb = _pid(sa), _pid(sb)
    ra, rb = {}, {}

    concurrency.spawn(_run, update_option, sa, ra, b["id"], OptionUpdate(is_correct=True))
    assert parked.wait(timeout=10), "worker A never reached the hook after the question lock"
    concurrency.spawn(_run, update_option, sb, rb, c["id"], OptionUpdate(is_correct=True))
    assert _wait_blocked(probe, pb, pa), "worker B did not wait on A's question lock"
    gate.set()
    for t in list(concurrency.threads):
        t.join(timeout=15)

    assert ra.get("ok") and rb.get("ok"), (ra, rb)
    assert _correct(probe, q["id"]) == ["O2"]


def test_two_concurrent_correct_creates_end_with_one_correct(concurrency, monkeypatch, request, admin_client):
    q, _ = _single_choice(admin_client)
    gate, parked = _park_first(monkeypatch, request)
    sa, sb, probe = concurrency.make_sessions(3)
    pa, pb = _pid(sa), _pid(sb)
    ra, rb = {}, {}

    concurrency.spawn(_run, create_option, sa, ra, q["id"], OptionCreate(text="A", is_correct=True))
    assert parked.wait(timeout=10), "worker A never reached the hook after the question lock"
    concurrency.spawn(_run, create_option, sb, rb, q["id"], OptionCreate(text="B", is_correct=True))
    assert _wait_blocked(probe, pb, pa), "worker B did not wait on A's question lock"
    gate.set()
    for t in list(concurrency.threads):
        t.join(timeout=15)

    assert ra.get("ok") and rb.get("ok"), (ra, rb)
    assert _correct(probe, q["id"]) == ["B"]


def _writer_waits_for_the_question(concurrency, monkeypatch, request, admin_client, writer, a_row_deleted=False):
    """A parks in a correctness change holding the question lock; B runs
    `writer(q, opts)` and must wait on that lock before touching any answer row."""
    q, opts = _single_choice(admin_client, True, False, False)
    gate, parked = _park_first(monkeypatch, request)
    sa, sb, probe = concurrency.make_sessions(3)
    pa, pb = _pid(sa), _pid(sb)
    ra, rb = {}, {}

    concurrency.spawn(_run, update_option, sa, ra, opts[2]["id"], OptionUpdate(is_correct=True))
    assert parked.wait(timeout=10), "worker A never reached the hook after the question lock"
    fn, args = writer(q, opts)
    concurrency.spawn(_run, fn, sb, rb, *args)
    assert _wait_blocked(probe, pb, pa), "worker B did not wait on A's question lock"
    assert _option_rows_free(probe, q["id"]), "worker B holds answer rows while waiting for the question"
    gate.set()
    for t in list(concurrency.threads):
        t.join(timeout=15)

    assert rb.get("ok"), (ra, rb)
    # A committed first. When B then deletes A's row, A's post-commit refresh
    # finds nothing: the codebase's commit-then-refresh pattern (5d backlog),
    # not a lock problem. Anything else from A is a failure.
    a_ok = ra.get("ok") or (a_row_deleted and "Could not refresh instance" in str(ra.get("error")))
    assert a_ok, (ra, rb)
    return q, probe


def test_option_reorder_takes_the_question_lock_first(concurrency, monkeypatch, request, admin_client):
    def writer(q, opts):
        order = ReorderRequest(order=[ReorderItem(id=o["id"], order=i + 1) for i, o in enumerate(reversed(opts))])
        return reorder_options, (q["id"], order)
    q, probe = _writer_waits_for_the_question(concurrency, monkeypatch, request, admin_client, writer)
    assert _correct(probe, q["id"]) == ["O2"]


def test_option_delete_takes_the_question_lock_first(concurrency, monkeypatch, request, admin_client):
    q, probe = _writer_waits_for_the_question(
        concurrency, monkeypatch, request, admin_client, lambda q, opts: (delete_option, (opts[1]["id"],)),
    )
    assert _correct(probe, q["id"]) == ["O2"]


def test_question_delete_takes_the_question_lock_first(concurrency, monkeypatch, request, admin_client):
    q, probe = _writer_waits_for_the_question(
        concurrency, monkeypatch, request, admin_client, lambda q, opts: (delete_question, (q["id"],)),
        a_row_deleted=True,
    )
    assert _correct(probe, q["id"]) == []


def test_item_delete_waits_for_the_question_before_its_answer_rows(concurrency, monkeypatch, request, admin_client):
    """An ancestor delete removes answer rows through the database's ON DELETE
    CASCADE (Question.options is passive_deletes), so the question row is locked
    before its answer rows — the D12 order. An ORM-side cascade would delete the
    answer rows first and deadlock against a correctness change."""
    q, probe = _writer_waits_for_the_question(
        concurrency, monkeypatch, request, admin_client,
        lambda q, opts: (delete_item, (q["item_id"],)),
        a_row_deleted=True,
    )
    assert _correct(probe, q["id"]) == []
