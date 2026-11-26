---
worth: yes
where: cli/cmd/install.go
added: 2026-11-26
---
# Install and tls enable print Docker and database noise

Seen on the rented server (2026-11-26). A re-run of `sudo mathion install` prints Docker's `[+] pull` and `[+] up` progress lines and two `INFO [alembic.runtime.migration]` lines before its ending; `sudo mathion tls enable` prints the same `[+] up` lines. An admin needs none of them: show them only when a step fails.

`tls enable`'s closing text also predates the install texts: it writes `mathion tls status` / `mathion logs` without `sudo` and in backticks, says "this host" instead of "this server", and does not say whether the certificate arrived (install waits for it and says so).
