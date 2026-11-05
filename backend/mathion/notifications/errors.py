import smtplib, socket

TRANSIENT_EXCS = (
    ConnectionRefusedError, TimeoutError, socket.gaierror,
    smtplib.SMTPServerDisconnected,
)

def classify(exc: BaseException) -> str:
    """RFC 5321: 4xx = transient (retry), 5xx = permanent (don't retry).

    A refused sender is never permanent: it is the server's side (a bad From,
    superuser Settings D9c), so the queue stops the batch instead of failing
    each message (`smtp_errors.stops_the_batch`)."""
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return 'transient'
    if isinstance(exc, smtplib.SMTPDataError):
        # D9c, extended (user 2026-11-05): a refusal after the body may be the
        # server's (Microsoft 365 refuses a From the login may not send as only
        # here), so it is retried and fails only when its tries run out.
        return 'transient'
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
