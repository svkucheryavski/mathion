---
worth: yes
where: frontend/src/lib/api.ts:90
added: 2026-11-15
---
# a 4xx with no JSON detail shows its raw status text

`request()` falls back to `res.statusText` when a 4xx answer has no JSON `detail`
(`errorDetail(res, parsedBody, res.statusText || REQUEST_ERROR_MESSAGE)`). A proxy or WAF page over
HTTP/1.1, such as nginx's 413 or a 403 page, then reads "Request Entity Too Large" or "Forbidden" on
every page that shows the error, and the roster banner reads "… 3 cancelled. Forbidden." A teacher
can't act on that.

Fix: use `REQUEST_ERROR_MESSAGE` instead of `statusText` for a 4xx with no JSON detail, in `request()`,
so every page gets it; then check the tests that pin the status-text fallback. `40f3d46` kept the
status text on purpose when it replaced the raw 5xx text, so look up why before changing it.

Found in the Settings minors round's Task 3 review, round 2 (Opus lane), 2026-11-15. The user wants
it fixed before the first beta.
