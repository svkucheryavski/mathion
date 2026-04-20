from mathion.models import AnswerOption, Block, Course, CourseVersion, Item, Question, Sequence


def _make_quiz_item(db):
    course = Course(slug="stats", name="Stats", description="")
    db.add(course)
    db.commit()
    version = CourseVersion(course_id=course.id, state="created", info_md="", info_html="")
    db.add(version)
    db.commit()
    block = Block(version_id=version.id, title="B1", slug="b1", order=1, info="")
    db.add(block)
    db.commit()
    seq = Sequence(block_id=block.id, title="S1", slug="s1", order=1)
    db.add(seq)
    db.commit()
    item = Item(sequence_id=seq.id, title="Quiz", slug="quiz", order=1, type="quiz")
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_create_single_choice_question(db):
    item = _make_quiz_item(db)
    q = Question(item_id=item.id, text_md="What is 2+2?", text_html="<p>What is 2+2?</p>", type="single_choice", order=1)
    db.add(q)
    db.commit()
    db.refresh(q)
    assert q.id is not None
    assert q.type == "single_choice"


def test_create_answer_options(db):
    item = _make_quiz_item(db)
    q = Question(item_id=item.id, text_md="What is 2+2?", text_html="<p>What is 2+2?</p>", type="single_choice", order=1)
    db.add(q)
    db.commit()
    opts = [
        AnswerOption(question_id=q.id, text="3", is_correct=False, order=1),
        AnswerOption(question_id=q.id, text="4", is_correct=True, order=2),
        AnswerOption(question_id=q.id, text="5", is_correct=False, order=3),
    ]
    db.add_all(opts)
    db.commit()
    db.refresh(q)
    assert len(q.options) == 3
    correct = [o for o in q.options if o.is_correct]
    assert len(correct) == 1
    assert correct[0].text == "4"


def test_create_numeric_question(db):
    item = _make_quiz_item(db)
    q = Question(item_id=item.id, text_md="Calculate sqrt(4)", text_html="<p>Calculate sqrt(4)</p>", type="numeric_answer", order=1, correct_numeric=2.0, precision=0)
    db.add(q)
    db.commit()
    db.refresh(q)
    assert q.correct_numeric == 2.0
    assert q.precision == 0


def test_create_text_question(db):
    item = _make_quiz_item(db)
    q = Question(item_id=item.id, text_md="Chemical formula of ethanol?", text_html="<p>Chemical formula of ethanol?</p>", type="text_answer", order=1, correct_text="C2H5OH")
    db.add(q)
    db.commit()
    db.refresh(q)
    assert q.correct_text == "C2H5OH"


def test_cascade_delete_item_deletes_questions(db):
    item = _make_quiz_item(db)
    q = Question(item_id=item.id, text_md="Q", text_html="Q", type="single_choice", order=1)
    db.add(q)
    db.commit()
    opt = AnswerOption(question_id=q.id, text="A", is_correct=True, order=1)
    db.add(opt)
    db.commit()
    db.delete(item)
    db.commit()
    assert db.query(Question).count() == 0
    assert db.query(AnswerOption).count() == 0
