"""Append two T3 reflow-exercising questions to the demo course's "mixed" quiz.

The demo fixture's prompts are plain sentences, so they exercise neither
`.text { overflow-wrap: anywhere }` nor `.text :global(pre)` — the two rules
Slice-3 T3 added for WCAG 1.4.10. This adds a prompt carrying a fenced code
block (the <pre> scroller + its focus ring) and one carrying a hyphen-free URL
and a long hash (Chromium takes no break opportunity after `/` or `.`, only
at `-`, so these are the shapes that actually overflow).

Idempotent: re-running deletes the questions it previously added, matched on
distinctive content (nh3 ESCAPES an HTML comment rather than stripping it, so a
marker in the prompt would render as visible text).

Run from the backend dir:  python -m scripts.seed_t3_reflow
"""

from decimal import Decimal

from sqlalchemy import or_, select

from mathion.database import SessionLocal
from mathion.markdown import render_markdown
from mathion.models import Block, Course, CourseVersion, Item, Question, Sequence

DEMO_SLUG = "demo-course"
QUIZ_SLUG = "mixed"
FINGERPRINTS = ("%solve_eigenvalue_system%", "%secondlawofthermodynamics%")

CODE_PROMPT = """Given the routine below, what does it return for a 2x2 identity pair?

```
def solve_eigenvalue_system(matrix_a, matrix_b, tolerance=1e-12, max_iterations=100000):
    return sum(matrix_a[i][i] * matrix_b[i][i] for i in range(len(matrix_a)))
```

Enter the numeric result."""

URL_PROMPT = (
    "Read the note at "
    "https://example.edu/coursematerials/thermodynamics/secondlawofthermodynamics/page12.html "
    "and verify the checksum `9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a3928`.\n\n"
    "What is the capital of Norway?"
)


def main() -> None:
    db = SessionLocal()
    try:
        item = db.scalars(
            select(Item)
            .join(Sequence, Item.sequence_id == Sequence.id)
            .join(Block, Sequence.block_id == Block.id)
            .join(CourseVersion, Block.version_id == CourseVersion.id)
            .join(Course, CourseVersion.course_id == Course.id)
            .where(Course.slug == DEMO_SLUG, Item.slug == QUIZ_SLUG)
            .order_by(CourseVersion.id.desc())
        ).first()
        if item is None:
            raise SystemExit(
                f"No item '{QUIZ_SLUG}' in course '{DEMO_SLUG}'. "
                "Run `python -m scripts.seed_demo` first."
            )

        existing = db.scalars(
            select(Question).where(
                Question.item_id == item.id,
                or_(*(Question.text_md.like(fp) for fp in FINGERPRINTS)),
            )
        ).all()
        for q in existing:
            db.delete(q)
        db.flush()

        next_order = 1 + max(
            (q.order for q in db.scalars(
                select(Question).where(Question.item_id == item.id)).all()),
            default=0,
        )
        for offset, (text_md, kind, extra) in enumerate((
            (CODE_PROMPT, "numeric_answer", {"correct_numeric": Decimal("2"), "precision": 0}),
            (URL_PROMPT, "text_answer", {"correct_text": "Oslo"}),
        )):
            db.add(Question(
                item_id=item.id,
                text_md=text_md,
                text_html=render_markdown(text_md),
                type=kind,
                order=next_order + offset,
                **extra,
            ))
        db.commit()
        print(
            f"[seed_t3_reflow] Added 2 reflow questions to item '{QUIZ_SLUG}' "
            f"(id={item.id}); replaced {len(existing)} previous."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
