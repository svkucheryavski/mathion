# Course archive: download a course version, upload it into another course

Status: approved by the owner (2026-11-27).

## Why

The owner wants to take a course version out of Mathion as one file and put it back in later or elsewhere, for three uses:

- **Moving a course between servers** (for example from a test server to the real one).
- **Sharing a course with colleagues** who run their own Mathion.
- **Backups** of a course, kept outside the server.

The Open edX import already brings courses in from Open edX. This feature is the Mathion-to-Mathion counterpart: exact, with nothing converted and nothing lost.

## Goals

- A course admin downloads any version of a course they administer as one `.tar.gz` file.
- A course admin uploads such a file into a course they administer, which creates a new draft holding the archived content and files.
- What comes back is the same course: every block, sequence, item, question, answer, explanation, info text, setting and file.
- An archive made today still uploads into later Mathion releases.

## Non-goals

- **Run data.** Runs, groups, students, teachers, mini-project assignments and deadlines (they belong to a run, `models.py:279`), submissions, evaluations and run files are never in an archive.
- **Creating a course on upload.** Courses are created by the superuser (`api/courses.py:28`) and need an admin. To move a course to a new server, the superuser first creates the empty course and its admin there; the admin then uploads the archive into it.
- **Hand-editing.** The archive is not meant to be edited by hand, so there is no Markdown file per item. A hand-edited archive is still checked like any other upload.
- **Export to Open edX.** Not wanted.
- **Server commands** (`mathion course export/import`). Possible later on the same format; not now.

## Anti-goals (a failure even if it technically works)

- Upload silently changes content: renames a file and breaks its links, drops an answer, re-orders items.
- The server unpacks archives people send it.
- An archive carries anything about people: user accounts, emails, ids, who uploaded a file.
- An archive from a newer Mathion is half-imported instead of refused with a clear reason.

## Approaches considered

1. **Like the Open edX import (chosen by the owner).** The server builds the download. On upload, the browser opens the archive, sends the course text to the server for a check, creates a draft, uploads the files one by one through the normal asset upload, then asks the server to build the content. Reuses the browser tar reader (`frontend/src/lib/olx/tar.ts`), the read caps (`readExport.ts`), per-file upload with retries and the status/discard recovery (`api/olx_import.py:185-224`). The server never unpacks an uploaded archive.
2. **The server does all of it.** One big upload of the `.tar.gz`, unpacked on the server. Less browser code, but no per-file retry, a much higher body limit, and the server unpacks untrusted archives. Rejected.
3. **Server commands only.** Fine for scripted backups, but colleagues and admins without server access cannot use them. Rejected for now; could sit on top of 1 later.

Using the Open edX format instead of an own one was also considered and rejected: the Open edX import converts and drops content by design (block info and the version's info text are not written, `olx/apply.py:91,100`), and an exporter to it would be a second converter to keep in step.

## The archive

One gzip-compressed tar file. Name on download (my call): `<course-slug>-v<version-id>.tar.gz`.

```
mathion-course.json     the course text (below)
assets/<filename>       every file of the version, by its stored name
```

- **All files of the version go in**, referenced or not, so a backup is complete.
- File names are already safe stored names (`assets.py:31` `sanitize_filename`), and Markdown and app items refer to files by bare name (`api/asset_render.py:52-57`, `Item.script_url`), so nothing is rewritten on the way out or in.

`mathion-course.json` holds:

- `format`: an integer, `1` for this design.
- `made_by`: the Mathion release that wrote it (for the reader; not used to decide anything).
- `course`: `name`, `slug`, `description`. Information only; upload never changes the target course.
- `version`: `label`, `info_md`, `max_quiz_attempts`.
- `blocks`, in order; each with `title`, `slug`, `info`, and `sequences`; each with `title`, `slug`, and `items`; each item with `title`, `slug`, `type` and the fields of its type (`content_md`, `video_url`, or `script` = the app's file name), plus `questions` for a quiz; each question with `type`, `text_md`, `explanation_md`, `correct_numeric` (as a string, to keep its exact digits), `precision`, `correct_text`, and `options` (`text`, `is_correct`) in order.
- Only the Markdown sources. Never the rendered HTML, database ids, timestamps, states, `uploaded_by`, or anything about runs or people.

The JSON is ordered by list position, so `order` numbers are not stored; upload numbers them 1, 2, 3 as the Open edX import does.

**Format versions.** Upload refuses an archive whose `format` is higher than it knows ("This archive was made by a newer Mathion. Update this server first."). A later format change raises the number, and upload keeps reading older numbers. Within one format number, upload refuses unknown keys, as the import bodies do today (`olx/bundle.py:22`).

## Download

- On the course's Versions page, each version row gets a **Download** icon button (the existing `download` glyph) next to Duplicate.
- A click first asks the server whether the version can be downloaded (a small check call, my call). A refusal shows its sentence on the page, the way the row's other refusals do; otherwise the page follows the archive link and the browser's own download takes over. A failure after the first byte can only show as the browser's failed download.
- Any version can be downloaded: draft, published, archived, and disabled (my call: a disabled version is still worth a backup).
- Course admins of the course only. A request from anyone else gets the same answers as the other version endpoints.
- The server writes the archive as it sends it (no full copy on disk or in memory). Before the first byte it checks that every file of the version is on disk, as duplicate does (`version_clone.py:33-41`), and that the text refers to no file the version lacks (`versions.py:95-109`); it refuses with a clear message otherwise, so no archive is made that its own upload would refuse.
- A draft can be edited while it downloads. The course text is read in one database snapshot; if a file disappears before it is sent, the download fails rather than produce an archive whose text points at a missing file. How to do that is the builder's call.

## Upload

Started from the Versions page, next to "Import from Open edX", with an **Import a Mathion archive** button (my call: a separate button, so the Open edX import stays as it is).

```
Versions                                   + Add version   Import from Open edX   Import a Mathion archive
  Calculus 1 (2026)   v. 15  Draft     ✎  ⧉  ⤓  ⊘  🗑
```

The modal follows the Open edX import modal's steps:

1. **Pick the file.** The browser reads it with the existing tar reader and caps. It needs `mathion-course.json` at the top and files only under `assets/`; anything else is a refusal naming the entry.
2. **Check.** The browser sends the JSON and the list of files (name and size) to a check endpoint. The server validates everything an editor would refuse (lengths, slugs, item and question types and their required fields, file names that are not already safe stored names, extensions, the site's per-file and per-version size limits) and that every file the text refers to is in the archive. The modal shows a summary (blocks, sequences, items, quizzes, files and their total size, the archive's course name and label, and the release that made it) or the reasons it cannot be imported.
3. **Import.** The browser creates a new draft in this course, uploads the files one by one through the normal asset upload with the Open edX import's retry rules, then calls build. Build writes the content into the empty draft in one transaction, rendering Markdown and recording file references the same way duplicate and the Open edX import do (`version_clone.py:100-170`, `olx/apply.py`).
4. **Done.** The modal says what was created and links to the new draft. There is no change report: nothing is converted.

- **"What an editor would refuse"** means the rules for saving a draft, not for publishing: an empty quiz, a missing numeric answer, an empty sequence or an app with no script are accepted, so a half-written draft survives the round trip.
- **Item text:** `content_md` goes in for every item that is not an app (video and quiz items can hold text too).
- **A file refused during upload fails the import** (Retry or Discard). It is never skipped, since there is no change report.
- **Draft label:** while importing, `Archive (unfinished): <archive label>`; when built, the archive's own label (my call). Two versions may share a label; the row shows the version id.
- **An interrupted import** leaves an unfinished draft, recovered or discarded exactly as an unfinished Open edX import is. The unfinished-import checks today know only the `Open edX (unfinished): ` prefix (`olx/convert.py:24`) and use "has a block" to tell a built draft (`api/olx_import.py:185`); both must also handle archive drafts, including a built archive with no blocks.
- **Upload carries script.** An archive can hold interactive apps (`.js` files), as a manual upload can. The modal says so in one sentence ("Import archives only from people you trust: interactive apps in them run in your students' browsers.").

## Constraints

- No new Python or JavaScript dependencies: stdlib `tarfile`/`gzip` on the server, the existing tar reader and `DecompressionStream` in the browser.
- The upload path reuses the existing request size cap and asset upload endpoint; no limit is raised.
- Every write follows the authoring rules already used by the Open edX build: the draft lock, the version must be an empty draft (`olx/apply.py:32-42`).

## Tests the owner should be able to rely on

- **Round trip:** a version with every item type, every question type, block info, version info, files used and unused, downloaded and uploaded into another course, gives the same content as a duplicate of it (same text, same order, same files).
- A newer `format`, an unknown key, an unsafe path, a file outside `assets/`, a missing referenced file, and a file over the site limit are each refused before a draft is made.

## Left to the builder

- How export streams and stays consistent with concurrent edits.
- How much of the Open edX import's code (modal, run steps, check/build/status/discard endpoints, `Plan`/`apply`) is shared versus copied, as long as the Open edX import's behaviour does not change.
- The exact wording of messages, in the style of the Open edX import's.
- Splitting the work: download first, then upload (the owner agreed to two parts).
