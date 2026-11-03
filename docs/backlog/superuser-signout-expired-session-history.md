---
worth: later
where: frontend/src/lib/auth.svelte.ts:54
added: 2026-11-03
---
# Sign out with an expired session leaves a /login?next=<dead panel link> history entry

On the superuser panel, Sign out calls `logout()`, whose `POST /api/auth/logout` is sent without
`skipAuthRedirect`. When the session cookie has already expired, that POST answers 401 and the app-wide
handler (`frontend/src/lib/api.ts:49`) navigates to `/login?next=<the panel's token path>` before the
shell's own `navigate('/login', { replace: true, force: true })` replaces it. The person still lands on
Login; the cost is one extra history entry pointing at a token URL that no longer works (logout destroys
the token). The main site's Logout goes through the same `logout()`.

Pre-existing; surfaced by the Fable lane (r2 M2) reviewing the superuser panel restyle. The likely fix is
`skipAuthRedirect: true` on the logout POST, but it touches every sign-out path, which is why it was not
folded into that change. Value unknown until someone actually meets it: settle it at the beta pass.
