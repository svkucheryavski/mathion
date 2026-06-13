from email.message import EmailMessage

from mathion.notifications.mailer import MemoryMailer


def test_memory_mailer_send_appends():
    m = MemoryMailer()
    msg = EmailMessage()
    msg["Subject"] = "test"
    with m.session():
        m.send(msg)
        m.send(msg)
    assert len(m.sent) == 2


def test_memory_mailer_session_is_noop():
    m = MemoryMailer()
    with m.session():
        pass  # should not raise
    assert m.sent == []
