import smtplib, socket

TRANSIENT_EXCS = (
    ConnectionRefusedError, TimeoutError, socket.gaierror,
    smtplib.SMTPServerDisconnected,
)

def classify(exc: BaseException) -> str:
    """RFC 5321: 4xx = transient (retry), 5xx = permanent (don't retry)."""
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        if not exc.recipients:
            return 'permanent'
        codes = [code for code, _msg in exc.recipients.values()]
        return 'permanent' if any(500 <= c <= 599 for c in codes) else 'transient'
    if isinstance(exc, smtplib.SMTPResponseException):
        code = exc.smtp_code
        return 'transient' if 400 <= code <= 499 else 'permanent'
    if isinstance(exc, TRANSIENT_EXCS):
        return 'transient'
    return 'permanent'
