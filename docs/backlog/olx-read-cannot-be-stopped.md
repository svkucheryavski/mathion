---
worth: no
where: frontend/src/components/editor/OlxImportModal.svelte:runCheck
added: 2026-11-22
---
# leaving the Open edX import mid-read keeps reading the export

Leaving the Versions page (or closing the modal's page) while the import modal is reading an export
unmounts the modal, but `readExport` keeps decompressing the archive in the background, up to the
reader's size cap. Nothing is sent to the server afterwards (`runCheck` checks `gone`), so the only
cost is CPU and memory until the read ends. Stopping it needs an abort signal threaded through
`readExport` (Task 8 code). Surfaced by Fable's Task 10 review (m2). Worth deciding once real
exports show how long a read takes on a teacher's laptop.

Owner 2026-11-24: no. The waste is one read, bounded by the reader's caps, invisible to the teacher, and ends by itself; an abort would touch the most-reviewed reader code. Reopen if a teacher reports a slow tab after leaving an import.
