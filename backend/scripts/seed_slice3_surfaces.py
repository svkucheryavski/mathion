"""Make the three Slice-3 student surfaces that `seed_demo` cannot reach
renderable in the demo course.

`seed_demo` builds only static_page / video / quiz items and no Run, so three
student components ship untouched by any manual visual pass:

  1. UnsupportedItem      — needs an item whose `type` is 'mini_project'
                            (ItemRouter.svelte:20 routes that type to it).
  2. InteractiveAppItem   — needs type='interactive_app' AND a real uploaded
                            .js asset, because the component fetches
                            `/assets/{version_id}/{script_url}` and renders the
                            'empty' placeholder when `script_url` is unset.
  3. MiniProjectLink +    — need a PUBLISHED Run with the student on it
     StatusPill             (RunStudent) and published MiniProject rows; the
                            list endpoint 403s without one and CourseView
                            swallows that into "no links".

Additive: this only appends to the course `seed_demo` already created, and
`--remove` puts it back exactly as `seed_demo` left it.

RUN ORDER MATTERS. `Run.version_id` is ON DELETE RESTRICT, so once this seed
has created a Run, `seed_demo` can no longer delete the demo course and will
fail with a ForeignKeyViolation. Run `--remove` first (the bundled
`run-slice3-surfaces.sh` does exactly that):

    python -m scripts.seed_slice3_surfaces --remove   # no-op if not seeded
    python -m scripts.seed_demo
    python -m scripts.seed_slice3_surfaces

ONE STATUS IS MUTUALLY EXCLUSIVE WITH THE OTHER SIX. `latest_status` is derived
per (mini-project, the student's group), and 'pending_group_assignment' means
"the student has NO group on the run" — a property of the student, not of the
mini-project. So a grouped student can never see it, and an ungrouped one sees
NOTHING ELSE. The default run puts the student in a group and seeds the other
six statuses, one per block; `--ungrouped` clears `RunStudent.group_id` so
every pill flips to 'Pending group'. Re-run without the flag to go back.

Idempotent: every run tears down what a previous run created before writing.

Caveat, stated because this seed writes a row the authoring API would reject:
`ItemCreate` restricts `type` to the four authorable types, so the
'mini_project' item exists only because this script writes the DB directly.
It renders fine on the student side (that is the point) and degrades to a
fallback glyph in the version editor's ItemRow; it is not authorable there.

Run from the backend dir:  python -m scripts.seed_slice3_surfaces [--remove]
                                                                  [--ungrouped]
"""

import os
import shutil
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

# `_asset_dir` is private, and imported anyway on purpose: it is the single
# definition of the on-disk course-asset layout. Re-deriving the join here
# would silently serve 404s ("Asset file missing") the day that layout moves.
from mathion.api.assets import _asset_dir
from mathion.api.submission_files import (
    build_feedback_filename,
    build_submission_filename,
    submission_storage_dir,
)
from mathion.database import SessionLocal
from mathion.markdown import render_markdown
from mathion.models import (
    Asset,
    AssetReference,
    Block,
    Course,
    CourseVersion,
    Evaluation,
    Group,
    Item,
    MiniProject,
    Run,
    RunStudent,
    RunTeacher,
    Sequence,
    Submission,
)
from mathion.models_auth import User

DEMO_SLUG = "demo-course"
DEV_EMAIL = "dev@mathion.test"
TEACHER_EMAIL = "teacher@mathion.test"

RUN_TITLE = "Demo Run (Slice-3 surfaces)"
GROUP_NAME = "A"

# The extra sequence carrying the two item types seed_demo never builds. Lives
# in seed_demo's first block so it is one click from the course view.
HOST_BLOCK_SLUG = "getting-started"
EXTRA_SEQ_SLUG = "more-item-types"

# Must match items.py's script_url guard: `[a-z0-9][a-z0-9.-]*\.js`.
SCRIPT_FILENAME = "slice3-demo-app.js"

# Four extra blocks. seed_demo ships two, and six blocks is the minimum that
# shows all six group-reachable pill states at once — the whole reason to look
# at StatusPill by eye. Titles are ordinary course content: the pill prints its
# own label ("Rejected", "Accepted"), so the block need not name the status.
EXTRA_BLOCKS = [
    ("data-handling", "Data Handling", "Cleaning and reshaping a real dataset."),
    ("modelling", "Modelling", "Fitting and comparing candidate models."),
    ("validation", "Validation", "Cross-validation and error estimates."),
    ("reporting", "Reporting", "Writing the results up for a reader."),
]

# (block slug, status to derive). Block order fixes the pill order in the
# course view; 'not_submitted' first so the top of the list is the state a
# student actually starts in.
MP_PLAN = [
    ("getting-started", "not_submitted"),
    ("practice", "awaiting_evaluation"),
    ("data-handling", "rejected"),
    ("modelling", "major_revision"),
    ("validation", "minor_revision"),
    ("reporting", "accepted"),
]

APP_JS = """// Slice-3 demo interactive app. Runs inside the sandboxed, opaque-origin
// iframe built by lib/interactiveHost.ts, under a CSP of
// `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`
// with `connect-src 'none'` — so: no network, no imports, no external CSS.
// Styling is inline for that reason, and the colours are the design tokens'
// literal values (the iframe cannot see the app's stylesheet).
(function () {
  var root = document.getElementById('app-root');
  root.style.cssText =
    'box-sizing:border-box;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#16181D';

  var h = document.createElement('h2');
  h.textContent = 'Sine explorer';
  h.style.cssText = 'margin:0 0 4px;font-size:18px;font-weight:600';
  root.appendChild(h);

  var p = document.createElement('p');
  p.textContent =
    'Drag the sliders to change the wave. Nothing here reaches the network.';
  p.style.cssText = 'margin:0 0 12px;color:#5A616E';
  root.appendChild(p);

  var canvas = document.createElement('canvas');
  canvas.width = 760;
  canvas.height = 300;
  canvas.style.cssText =
    'width:100%;height:300px;display:block;border:1px solid #E3E5EA;border-radius:6px';
  root.appendChild(canvas);

  var controls = document.createElement('div');
  controls.style.cssText =
    'display:flex;gap:24px;flex-wrap:wrap;margin-top:12px;align-items:center';
  root.appendChild(controls);

  var state = { amp: 0.7, freq: 2 };

  function slider(label, key, min, max, step) {
    var wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;gap:8px;align-items:center';
    var name = document.createElement('span');
    name.textContent = label;
    var input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = state[key];
    var out = document.createElement('output');
    out.style.cssText =
      'min-width:3.5ch;font-variant-numeric:tabular-nums;color:#3D4350';
    out.textContent = state[key];
    input.addEventListener('input', function () {
      state[key] = parseFloat(input.value);
      out.textContent = input.value;
      draw();
    });
    wrap.appendChild(name);
    wrap.appendChild(input);
    wrap.appendChild(out);
    controls.appendChild(wrap);
  }

  function draw() {
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var hgt = canvas.height;
    ctx.clearRect(0, 0, w, hgt);

    ctx.strokeStyle = '#F0F1F4';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= w; gx += w / 12) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, hgt);
      ctx.stroke();
    }
    ctx.strokeStyle = '#DDE1E9';
    ctx.beginPath();
    ctx.moveTo(0, hgt / 2);
    ctx.lineTo(w, hgt / 2);
    ctx.stroke();

    ctx.strokeStyle = '#16181D';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = 0; x <= w; x++) {
      var t = (x / w) * Math.PI * 2 * state.freq;
      var y = hgt / 2 - Math.sin(t) * state.amp * (hgt / 2 - 12);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  slider('amplitude', 'amp', 0, 1, 0.01);
  slider('cycles', 'freq', 1, 8, 1);
  draw();
})();
"""

ASSIGNMENT_MD = """## What to hand in

A short PDF covering:

- what you did and why,
- the figures that support it,
- anything that did not work.

Style guidance lives at
[the course handbook](https://example.edu/handbook/mini-projects).
"""


def _demo_version(db: DBSession, required: bool = True) -> CourseVersion | None:
    """The demo course's newest version, or None when there is nothing to act on.

    `required=False` is what lets `--remove` run BEFORE `seed_demo` on a fresh
    database: the runner script calls it unconditionally (see its comment on
    ON DELETE RESTRICT), and a missing course there is the expected state, not
    an error to abort the whole run on.
    """
    course = db.execute(
        select(Course).where(Course.slug == DEMO_SLUG)
    ).scalar_one_or_none()
    if course is None:
        if required:
            raise SystemExit(
                f"No course '{DEMO_SLUG}'. Run `python -m scripts.seed_demo` first."
            )
        return None
    version = db.execute(
        select(CourseVersion)
        .where(CourseVersion.course_id == course.id)
        .order_by(CourseVersion.id.desc())
    ).scalars().first()
    if version is None:
        if required:
            raise SystemExit(f"Course '{DEMO_SLUG}' has no version.")
        return None
    return version


def remove(db: DBSession, version: CourseVersion) -> str:
    """Undo everything `seed()` writes, in FK dependency order.

    Core `delete()` (not `db.delete(obj)`) so the DB's own ON DELETE CASCADE
    does the fan-out — deleting the Run takes RunStudent, RunTeacher and Group
    with it. MiniProject is the exception that forces the ordering: its
    `block_id` is ON DELETE RESTRICT, so every MP must go before its block.
    """
    run_ids = db.execute(
        select(Run.id).where(Run.version_id == version.id, Run.title == RUN_TITLE)
    ).scalars().all()

    if run_ids:
        mp_ids = db.execute(
            select(MiniProject.id).where(MiniProject.run_id.in_(run_ids))
        ).scalars().all()
        if mp_ids:
            sub_ids = db.execute(
                select(Submission.id).where(Submission.mini_project_id.in_(mp_ids))
            ).scalars().all()
            if sub_ids:
                db.execute(delete(Evaluation).where(Evaluation.submission_id.in_(sub_ids)))
                db.execute(delete(Submission).where(Submission.id.in_(sub_ids)))
            db.execute(delete(MiniProject).where(MiniProject.id.in_(mp_ids)))
        db.execute(delete(Run).where(Run.id.in_(run_ids)))

    db.execute(
        delete(Block).where(
            Block.version_id == version.id,
            Block.slug.in_([slug for slug, _t, _i in EXTRA_BLOCKS]),
        )
    )

    host = db.execute(
        select(Block).where(Block.version_id == version.id, Block.slug == HOST_BLOCK_SLUG)
    ).scalar_one_or_none()
    if host is not None:
        db.execute(
            delete(Sequence).where(
                Sequence.block_id == host.id, Sequence.slug == EXTRA_SEQ_SLUG
            )
        )

    db.execute(
        delete(Asset).where(
            Asset.version_id == version.id, Asset.filename == SCRIPT_FILENAME
        )
    )
    db.commit()

    # Files last: the rows are gone either way, and an orphaned file is a much
    # smaller problem than a row whose file vanished mid-transaction.
    script_path = os.path.join(_asset_dir(version.id), SCRIPT_FILENAME)
    if os.path.isfile(script_path):
        os.remove(script_path)
    for rid in run_ids:
        # dirname of a group dir is the run's whole submissions tree — derived
        # from the helper rather than re-joined, for the same reason as
        # `_asset_dir` above. Group 0 never exists; only the parent is used.
        subs_dir = os.path.dirname(submission_storage_dir(rid, 0))
        if os.path.isdir(subs_dir):
            shutil.rmtree(subs_dir)

    return f"removed {len(run_ids)} run(s), the extra blocks/sequence, and the app asset"


def _get_or_create_user(db: DBSession, email: str, full_name: str) -> User:
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email, full_name=full_name)
        db.add(user)
        db.flush()
    return user


def seed(ungrouped: bool = False) -> None:
    db = SessionLocal()
    try:
        version = _demo_version(db)
        assert version is not None  # required=True raises rather than returning
        remove(db, version)

        student = _get_or_create_user(db, DEV_EMAIL, "Dev")
        teacher = _get_or_create_user(db, TEACHER_EMAIL, "Demo Teacher")

        # ---- 1 + 2: the two unreachable item types -----------------------
        host = db.execute(
            select(Block).where(
                Block.version_id == version.id, Block.slug == HOST_BLOCK_SLUG
            )
        ).scalar_one()
        next_seq_order = 1 + max(
            (s.order for s in db.execute(
                select(Sequence).where(Sequence.block_id == host.id)
            ).scalars().all()),
            default=0,
        )
        seq = Sequence(
            block_id=host.id, title="More item types",
            slug=EXTRA_SEQ_SLUG, order=next_seq_order,
        )
        db.add(seq)
        db.flush()

        os.makedirs(_asset_dir(version.id), exist_ok=True)
        script_bytes = APP_JS.encode("utf-8")
        with open(os.path.join(_asset_dir(version.id), SCRIPT_FILENAME), "wb") as fh:
            fh.write(script_bytes)
        asset = Asset(
            version_id=version.id, filename=SCRIPT_FILENAME,
            file_size=len(script_bytes), mime_type="application/javascript",
            uploaded_by=teacher.id,
        )
        db.add(asset)
        db.flush()

        app_item = Item(
            sequence_id=seq.id, title="Sine explorer", slug="sine-explorer",
            order=1, type="interactive_app", script_url=SCRIPT_FILENAME,
        )
        db.add(app_item)
        db.flush()
        # Without this row the asset reads as unreferenced and the version
        # editor's asset panel offers it for deletion.
        db.add(AssetReference(asset_id=asset.id, item_id=app_item.id))

        db.add(Item(
            sequence_id=seq.id, title="Course project", slug="course-project",
            order=2, type="mini_project",
        ))

        # ---- 3: run, group, mini-projects, pills ------------------------
        today = date.today()
        run = Run(
            version_id=version.id, title=RUN_TITLE,
            start_date=today - timedelta(days=30),
            end_date=today + timedelta(days=60),
            groups_enabled=True, is_published=True, created_by=teacher.id,
        )
        db.add(run)
        db.flush()
        db.add(RunTeacher(run_id=run.id, user_id=teacher.id))

        group = Group(run_id=run.id, name=GROUP_NAME)
        db.add(group)
        db.flush()
        db.add(RunStudent(
            run_id=run.id, user_id=student.id,
            group_id=None if ungrouped else group.id,
        ))

        now = datetime.now(timezone.utc)
        blocks = {
            b.slug: b for b in db.execute(
                select(Block).where(Block.version_id == version.id)
            ).scalars().all()
        }
        for slug, title, info in EXTRA_BLOCKS:
            order = 1 + max(b.order for b in blocks.values())
            block = Block(
                version_id=version.id, title=title, slug=slug, order=order,
                info=info, info_html=render_markdown(info),
            )
            db.add(block)
            db.flush()
            blocks[slug] = block
            # One page item so the block is navigable rather than an empty
            # accordion — the mini-project row is not the only thing in it.
            body = f"## {title}\n\n{info}\n\nWork through this before the mini-project."
            bseq = Sequence(block_id=block.id, title="Notes", slug="notes", order=1)
            db.add(bseq)
            db.flush()
            db.add(Item(
                sequence_id=bseq.id, title="Notes", slug="notes", order=1,
                type="static_page", content_md=body, content_html=render_markdown(body),
            ))

        written_files: list[tuple[int, str]] = []
        for slug, status in MP_PLAN:
            block = blocks[slug]
            mp = MiniProject(
                run_id=run.id, block_id=block.id,
                assignment_md=ASSIGNMENT_MD,
                assignment_html=render_markdown(ASSIGNMENT_MD),
                soft_deadline=now + timedelta(days=7),
                hard_deadline=now + timedelta(days=14),
                resubmission_deadline=now + timedelta(days=21),
                is_published=True,
            )
            db.add(mp)
            db.flush()

            if status == "not_submitted":
                continue

            sub_name = build_submission_filename(block.order, group.name, 1)
            sub = Submission(
                mini_project_id=mp.id, group_id=group.id, submission_number=1,
                submitted_by=student.id, file_path=sub_name, file_size=9,
            )
            db.add(sub)
            db.flush()
            written_files.append((group.id, sub_name))
            if status == "awaiting_evaluation":
                continue

            # `ck_evaluation_feedback_file_required`: anything but 'accepted'
            # MUST carry a feedback file. 'accepted' deliberately does not, so
            # the detail page's no-feedback-file branch is on screen too.
            feedback = (
                None if status == "accepted"
                else build_feedback_filename(block.order, group.name, 1)
            )
            db.add(Evaluation(
                submission_id=sub.id, evaluated_by=teacher.id, result=status,
                score=95 if status == "accepted" else None,
                feedback_text=f"Seeded '{status}' evaluation for the visual pass.",
                feedback_file=feedback,
            ))
            if feedback is not None:
                written_files.append((group.id, feedback))

        db.commit()

        for group_id, name in written_files:
            d = submission_storage_dir(run.id, group_id)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, name), "wb") as fh:
                fh.write(b"%PDF-1.4\n")

        print(f"[seed_slice3_surfaces] course '{DEMO_SLUG}' version_id={version.id}")
        print(f"  interactive_app  '{app_item.title}'  -> {HOST_BLOCK_SLUG}/{EXTRA_SEQ_SLUG}")
        print(f"  mini_project     'Course project'    -> {HOST_BLOCK_SLUG}/{EXTRA_SEQ_SLUG} (UnsupportedItem)")
        print(f"  run '{RUN_TITLE}' id={run.id}, student {'UNGROUPED' if ungrouped else 'in group ' + GROUP_NAME}")
        if ungrouped:
            print("  all 6 mini-project pills read 'Pending group' (that is what --ungrouped is for)")
        else:
            for slug, status in MP_PLAN:
                print(f"    {blocks[slug].title:<16} {status}")
    finally:
        db.close()


def main() -> None:
    args = set(sys.argv[1:])
    unknown = args - {"--remove", "--ungrouped"}
    if unknown:
        raise SystemExit(f"Unknown argument(s): {' '.join(sorted(unknown))}")
    if "--remove" in args:
        db = SessionLocal()
        try:
            version = _demo_version(db, required=False)
            if version is None:
                print(f"[seed_slice3_surfaces] no '{DEMO_SLUG}' course — nothing to remove")
            else:
                print(f"[seed_slice3_surfaces] {remove(db, version)}")
        finally:
            db.close()
        return
    seed(ungrouped="--ungrouped" in args)


if __name__ == "__main__":
    main()
