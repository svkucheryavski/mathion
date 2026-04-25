# Mathion Platform Design Spec

A lightweight, open-source LMS (Learning Management System) for online courses with support for scheduled course runs and group-based mini-projects.

**Tech stack:** Python (FastAPI + SQLAlchemy), Svelte 5.x, PostgreSQL, Docker.

---

## 1. Core Decisions

| Area | Decision |
|------|----------|
| Auth | Passwordless PIN via email, CLI-generated PINs for superuser recovery |
| Access | Registration required, admin-controlled enrollment (free-pace) or teacher-controlled (runs) |
| Content editing | Markdown + LaTeX, stored as MD + pre-rendered HTML |
| Course delivery | Full course as single JSON, separate user state JSON |
| Quiz evaluation | Server-side, store last attempt + count, max attempts configurable (default 3) |
| Quiz feedback | Score only during attempts; correct answers + explanations revealed after max attempts |
| Interactive apps | Self-contained JS bundles in sandboxed iframes, trusted admin content |
| Communication | Deferred to a future version |
| Notifications | Email: enrollment, mini-project deadlines (including resubmission), evaluation results, teacher summaries. In-app: archived version banner |
| Email storage | Plain text, database-level encryption at rest |
| i18n | English only |
| Assets | Full copy on new version, 20MB/file, 500MB/course, no SVG uploads |
| Admin UI | Separate area within the same app (`/manage/...`) |
| Superuser | Full panel behind CLI-generated time-limited URL token |
| Mobile | Tablet-friendly, not phone-optimized |
| CSRF | SameSite=Lax session cookie + custom request header |

---

## 2. Data Model

### Course

Lightweight container: `slug` (unique, URL-friendly), `name`, `description`.

### CourseAdmin

Join between User and Course. Fields: `user_id`, `course_id`. Admins manage all versions of a course. Multiple admins allowed — superuser sees a warning about concurrency when adding a second admin. **Teachers exist only on runs (`RunTeacher`), never on courses or course versions.**

### CourseVersion

Belongs to one Course. Fields:
- `state`: `created` | `published` | `archived`
- `info_md`, `info_html`: rich text with general course information
- `created_at`, `published_at`, `archived_at`: timestamps
- `max_quiz_attempts`: integer, default 3
- `content_updated_at`: timestamp, updated on every content save (used for cache invalidation via ETag)

**Version publishing rule:** Multiple versions can be published simultaneously. The newest published version is the "active" one — all new free-pace student enrollments and new run creations use the newest published version. Older published versions continue serving their existing students and runs.

**State transitions:**
- `created` -> `published`: always allowed
- `published` -> `created`: only if zero students assigned AND zero runs exist
- `published` -> `archived`: always allowed (admin does this manually when ready)
- `archived`: terminal, no transitions out

**Access lockout (`is_disabled`):** An independent operational flag on CourseVersion, separate from the state machine. Default false. Can be set on a version in any state (though most useful for archived versions). When enabled, blocks all user access to the version content — students, teachers, and run operations are all suspended. The version state does not change. Data is preserved. Admin can toggle it back at any time. Think of it as an emergency circuit breaker, not a lifecycle state. A disabled published version is still published — it's just temporarily inaccessible. **The UI must require explicit high-risk confirmation before disabling** (e.g., "This will immediately suspend access for N students, N teachers, and N active runs. Are you sure?"), showing the actual impact counts.

**Editing rules by state:**

*Created* — everything is editable: add, remove, reorder, modify any element.

*Published* — only content corrections allowed (fix typos, broken links, wrong answer keys). No structural changes. Precise matrix:

| Element | Edit text/content | Change correct answer | Add/remove | Reorder |
|---------|:-:|:-:|:-:|:-:|
| Block title/info | Yes | — | No | No |
| Sequence title | Yes | — | No | No |
| Item title | Yes | — | No | No |
| Static page content | Yes | — | — | — |
| Video URL | Yes | — | — | — |
| Interactive app URL | Yes | — | — | — |
| Quiz question text | Yes | — | No | No |
| Quiz question explanation | Yes | — | — | — |
| Quiz answer option text | Yes | — | No | No |
| Quiz answer correct flag (`is_correct`) | — | Yes | — | — |
| Quiz numeric `correct_value` / `precision` | — | Yes | — | — |
| Quiz text `correct_value` | — | Yes | — | — |
| Question type (single→multiple, etc.) | — | — | No | — |

*Archived* — nothing is editable.

**Deletion:** only in `created` state.

**Concurrency control:** Optimistic locking via `updated_at` timestamps on all editable entities. Save is rejected if the entity was modified by another admin since it was loaded — user sees the current version and can retry.

### Block

Belongs to a CourseVersion. Fields: `title`, `slug`, `order` (1-based), `info` (short text). Max 8 blocks per version. Must have at least one sequence when version is published.

### Learning Sequence

Belongs to a Block. Fields: `title`, `slug`, `order` (1-based). Max 8 per block.

### Learning Item

Belongs to a Sequence. Fields: `title`, `slug`, `order` (1-based), `type`.

Item types and type-specific data:
- **static_page**: `content_md`, `content_html`
- **video**: `video_url` (validated external URL)
- **quiz**: has child Questions
- **interactive_app**: `script_url` (external URL or asset reference), rendered in an iframe (`sandbox="allow-scripts"` without `allow-same-origin`). **Trust model:** interactive apps are treated as trusted admin content. The sandbox prevents the app from accessing the parent page's DOM, cookies, and storage, but does NOT prevent it from making network requests or other non-DOM operations. The course admin takes full responsibility for the safety of any JS they upload or link. This is comparable to installing a plugin — admin-trusted, not user-safe by default.

### Quiz Question

Belongs to a quiz Item. Fields: `text_md`, `text_html`, `type`, `order`, `explanation_md` (optional), `explanation_html` (optional — revealed only after all attempts are used).

Question types:
- **single_choice**: list of AnswerOptions, exactly one correct
- **multiple_choice**: list of AnswerOptions, one or more correct
- **numeric_answer**: `correct_value` (float), `precision` (decimals)
- **text_answer**: `correct_value` (string, trimmed for comparison)

### AnswerOption

Belongs to a Question (choice types only). Fields: `text`, `is_correct`, `order`.

### User

Fields: `full_name` (entered by user at first login, editable), `email`, `is_superuser`, `is_disabled` (boolean, default false), `photo_url` (optional, stored in `/assets/users/{user_id}.jpg`).

No password stored. Disabled users cannot log in (PIN request is silently ignored, same response as unknown email). Disabling a user invalidates all their active sessions immediately.

### StudentEnrollment

Join between User and CourseVersion. Fields: `user_id`, `version_id`, `is_active` (boolean). One active enrollment per course at a time. New enrollment is always on the newest published version. When a student is re-enrolled in a newer version, the old enrollment is marked `is_active = false` and preserved as history (with all progress). The course slug routes to the active enrollment.

### UserItemState

Per user, per item. Fields:
- `is_covered` (boolean)
- `time_spent` (total seconds)
- `last_visited_at`

For quiz items additionally:
- `last_answers` (JSON)
- `last_score` (correct count + total count)
- `attempt_count`

### Relationship Overview

```
Course
  +-- CourseAdmin (many:many with User — course-level)
  +-- CourseVersion (1:many)
        |-- Block (1:many, max 8)
        |     +-- Sequence (1:many, max 8)
        |           +-- Item (1:many)
        |                 +-- Question (1:many, quiz only)
        |                       +-- AnswerOption (1:many, choice types)
        |-- Asset (1:many)
        +-- StudentEnrollment (many:many with User — version-level)

Run (belongs to CourseVersion)
  |-- RunTeacher (many:many with User — run-level)
  |-- Group (1:many)
  |     +-- GroupMember (many:many with User)
  +-- MiniProject (1:many, one per block)
        +-- Submission (1:many per group)
              +-- Evaluation (1:1)

User
  |-- CourseAdmin (many — across courses)
  |-- StudentEnrollment (many — across versions)
  +-- UserItemState (many — per item)

Session
  |-- user_id, token (hashed), expires_at, created_at, last_active_at
```

---

## 3. Authentication and Sessions

### Login Flow

1. User enters email
2. Server generates a 6-digit PIN (hashed in DB, expires in 10 minutes, single-use)
3. Same "PIN sent" response regardless of whether email exists (prevent enumeration)
4. User enters PIN, selects session duration (1, 7, or 30 days)
5. Server creates a session record

### Sessions

- Stored in database: `user_id`, `token` (random, hashed), `expires_at`, `created_at`, `last_active_at`
- `last_active_at` updated on each request, throttled (write to DB only if last update was >5 minutes ago)
- Sent via HTTP-only cookie (`SameSite=Lax`) on each request
- All API requests must include a custom header (`X-Requested-With: mathion`) to prevent CSRF
- Server checks `is_disabled` on every authenticated request — if disabled, session is destroyed and request returns 401
- Manual logout destroys the session record
- Expired sessions cleaned up by periodic background task

### PIN Security

- Max 3 PIN requests per email per hour
- Max 5 failed PIN entries per email per hour
- PIN expires after 10 minutes
- PINs stored hashed
- No IP-based rate limiting (university NAT/proxy would block legitimate users)

### User Registration

- No self-registration. Users are created when admin/teacher enters their email for enrollment
- At first login, user is prompted to enter their full name (and optionally upload a photo)
- Admins/superusers can disable user accounts (`is_disabled = true`). Disabled users cannot log in and all active sessions are immediately invalidated.

**Enrollment methods:**
- **Single:** admin/teacher enters an email address
- **Text area:** admin/teacher pastes a list of emails (one per line) — names not included, users enter their own name at first login
- **CSV upload:** file with columns depending on context:
  - Course enrollment: `email, name` (name is optional, pre-fills the account)
  - Run enrollment (groups disabled): `email, name`
  - Run enrollment (groups enabled): `email, name, group` (group number/name for automatic group assignment)

Batch enrollment emails sent in portions of 10 with short delays between batches.

---

## 4. Course Content Pipeline

### Authoring

Admins write content in Markdown with extensions:
- Standard Markdown (bold, italic, headings, lists, links, images)
- LaTeX math: `$...$` (inline) and `$$...$$` (block)
- Asset references use short filenames only: `![alt](diagram.png)`, `[slides](slides.pdf)` — resolved to full paths at render time

Quizzes use a structured form UI (not Markdown) — question text supports Markdown+LaTeX but quiz structure is form-driven.

### Asset Insertion in Editor

Two toolbar buttons: "Add image" and "Add file":
1. Opens a popup showing existing assets for this course version (filtered by type)
2. Admin selects an existing asset or uploads a new one
3. Editor inserts a short reference: `![alt text](diagram.png)` or `[download slides](slides.pdf)` — just the filename, no path
4. Authors never see or type version IDs or full paths

### Processing

On every save:
1. Parse Markdown
2. Scan for asset references (image and link patterns)
3. Validate each referenced filename exists in this version's asset registry — reject save if any are missing
4. Render LaTeX to KaTeX HTML
5. Resolve asset references to full paths in rendered HTML: `<img src="/assets/{version_id}/diagram.png">`
6. Sanitize output (strip `<script>`, event handlers, etc.)
7. Store both `content_md` (source with short filenames) and `content_html` (rendered with full paths)
8. Update `content_updated_at` on the CourseVersion (for cache invalidation)

### Delivery

**Content JSON** (cacheable, same for all students in a version):

Served with `ETag` header based on `content_updated_at`. Frontend sends `If-None-Match` on subsequent requests — server returns `304 Not Modified` if unchanged.

```json
{
  "course": { "name": "...", "slug": "..." },
  "version": { "id": "...", "state": "published", "info_html": "..." },
  "blocks": [
    {
      "id": "...", "title": "...", "slug": "...", "order": 1, "info": "...",
      "sequences": [
        {
          "id": "...", "title": "...", "slug": "...", "order": 1,
          "items": [
            {
              "id": "...", "title": "...", "slug": "...", "order": 1,
              "type": "static_page",
              "content_html": "..."
            },
            {
              "id": "...", "title": "...", "slug": "...", "order": 2,
              "type": "quiz",
              "questions": [
                {
                  "id": "...", "text_html": "...", "type": "single_choice",
                  "options": [
                    { "id": "...", "text": "Option A" },
                    { "id": "...", "text": "Option B" }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Quiz questions include options but never correct answers or explanations.

**State JSON** (per user, per version — served with `Cache-Control: private, no-store`):

```json
{
  "version_id": "...",
  "current_item_id": "...",
  "items": {
    "item_id_1": {
      "is_covered": true,
      "time_spent": 245
    },
    "item_id_2": {
      "is_covered": true,
      "type": "quiz",
      "attempt_count": 2,
      "max_attempts": 3,
      "last_score": { "correct": 3, "total": 5 },
      "last_answers": { "q1": ["opt_a"], "q2": ["opt_b", "opt_c"], "q3": "1.23" }
    }
  }
}
```

### Quiz Feedback

- **During attempts (attempt_count < max_attempts):** student sees score only ("3 out of 5 correct"). No indication of which answers were right or wrong.
- **After max attempts used:** answers are locked and cannot be modified. Student sees correct answers highlighted and optional explanation per question (from `explanation_html`). Correct answers and explanations are served by a separate "reveal" endpoint that only responds after max attempts are reached.

### URL Navigation

```
/course-slug#block-slug/sequence-slug/item-slug
```

Example: `/applied-statistics#descriptive-stats/quantiles/intro`

Frontend parses the hash, navigates within the loaded JSON. No page reloads. Browser back/forward works via hash changes. Slugs auto-generated from titles, unique within their parent level.

### Version Routing and Enrollment Semantics

**Enrollment pinning:** When a student is enrolled in a course, they are assigned to a specific version (always the newest published at time of enrollment). They are **pinned** to that version — their progress, quiz attempts, and state all belong to it. Publishing a newer version does not move existing students. They remain on their enrolled version even if it is later archived.

**Admin re-enrollment:** An admin can re-enroll a student in a newer version. This creates a new enrollment on the new version. The old enrollment and all its progress are preserved in the student's course history. The student starts fresh on the new version — progress does not transfer. Students cannot request re-enrollment themselves.

**URL resolution:** When a user visits `/course-slug`, the backend resolves which version to serve:

| User situation | Version served |
|----------------|---------------|
| Student with one enrollment | Their enrolled version (even if archived) |
| Student with multiple enrollments (re-enrolled) | The newest enrollment. Older enrollments accessible via course history view. |
| Admin (not enrolled as student) | Redirected to course management (`/manage/course-slug`) |
| Admin who is also enrolled as student | Student view of their enrolled version (admin can switch to management via `/manage/`) |
| Not enrolled and not admin | 403 — no access |

The content JSON endpoint always requires an explicit `version_id` parameter. The slug-based URL is a convenience layer — the frontend resolves it to the student's active enrollment version on initial load, then pins to that version for the session.

**Summary of "newest published" vs. "enrolled version":**
- "Newest published" is used only at the moment of enrollment and run creation — it determines which version new students and new runs get assigned to
- After enrollment, the student is pinned to their assigned version — "newest published" is irrelevant to them
- The course homepage (`/course-slug`) always shows the enrolled version, never the latest published

---

## 5. Asset Management

### Storage

Assets stored on the filesystem outside the application:

```
/data/mathion/assets/
  courses/
    {version_id}/
      slides.pdf
      diagram.png
  users/
    {user_id}.jpg
```

Base path configurable during installation.

### Registry

Every asset tracked in a database table: `id`, `version_id`, `filename` (sanitized), `file_size`, `mime_type`, `uploaded_at`, `uploaded_by`.

### Access Control

Assets served through the backend with role verification. Request to `/assets/{version_id}/file.pdf` checks that the version is not disabled and that the user has any role on that version (admin via course, student via enrollment, teacher via run) before serving. Disabled versions return 403 for all asset requests.

### Upload Rules

- Max 20MB per file (configurable)
- Max 500MB per course version (configurable)
- Allowed types: images (PNG, JPG, GIF), documents (PDF, CSV, XLS, XLSX, PPT, PPTX), code (R, Python, MATLAB), JavaScript files, plus a configurable whitelist
- SVG files are **not** allowed (XSS risk)
- Filenames sanitized: lowercase, spaces to hyphens, special characters stripped
- Duplicate filenames within a version rejected

### Usage Tracking

The registry tracks which items reference each asset. This enables:
- Warning when deleting an asset that is still referenced by content
- Showing "unused assets" so admins can clean up
- Updated automatically during the save/render step when Markdown is scanned for asset references

### Version Copy

When creating a new version: copy all files to a new directory, create new registry entries. Total size checked before copying. Markdown source uses short filenames, so copied content works without modification — the system resolves to the new version's path at render time.

**Future optimization:** The full-copy approach is simple and sufficient for V1. If storage becomes a concern at scale, the physical storage can be switched to content-addressed deduplication (files stored by hash, shared across versions) without changing the logical model — each version's asset registry and Markdown references remain identical. This is a backend-only change, invisible to users.

---

## 6. Course Runs and Mini-Projects

### Roles

- **Admin** (course-level): creates versions, publishes, creates runs, assigns teachers to runs, enrolls free-pace students. Managed via `CourseAdmin` table.
- **Teacher** (run-level only): invites students to the run, evaluates mini-projects, monitors student progress within the run. Managed via `RunTeacher` table. No course-level teacher role exists.
- **Student**: either free-pace (version-level, enrolled by admin) or in a run (enrolled by teacher). Free-pace students are monitored by admin only.

### Course Run

A time-bounded scheduled instance of a course version.

Fields: `id`, `version_id` (must be published at time of run creation), `title`, `start_date`, `end_date`, `groups_enabled` (boolean), `created_by`.

Rules:
- New runs always use the newest published version
- A published version can have multiple concurrent runs
- Each run has its own teachers via `RunTeacher` join table (`run_id`, `user_id`)
- Only run teachers have access to mini-projects and student progress within that run
- Students in a run also have the regular student enrollment on the version
- If the version is later archived, existing runs continue normally — including adding new students to those runs
- After run ends, students retain normal course access + can view run history

### Groups

Only when `groups_enabled = true`. Fields: `id`, `run_id`, `name`.

Rules: 1-10 students per group, one group per student per run, students must be assigned to a group when added to a run with groups enabled.

### Mini-Projects

One per block per run. Fields: `id`, `run_id`, `block_id`, `assignment_md`, `assignment_html`, `soft_deadline`, `hard_deadline`, `resubmission_deadline`.

Additional files (datasets, code) stored in a run-specific asset directory.

### Submissions

Fields: `id`, `mini_project_id`, `group_id`, `submitted_by`, `submitted_at`, `file_path` (PDF), `is_resubmission` (boolean).

Rules:
- Any group member can submit on behalf of the group
- No initial submission after hard deadline
- No resubmission after resubmission deadline
- Resubmission after `major_revision` or `minor_revision` is auto-accepted

### Evaluations

Fields: `id`, `submission_id` (UNIQUE — one evaluation per submission), `evaluated_by`, `evaluated_at`, `result` (`rejected` | `major_revision` | `minor_revision` | `accepted`), `score` (optional, integer 0-100), `feedback_text` (optional short text), `feedback_file` (optional PDF, mandatory if result is not "accepted").

### Evaluation Results

- **accepted**: done, no further action
- **major_revision**: report needs significant improvement. One resubmission allowed, auto-accepted.
- **minor_revision**: report needs small fixes. One resubmission allowed, auto-accepted.
- **rejected**: wrong document / completely off-topic. Resets the submission — the group can submit again as a fresh initial submission (before hard deadline). The rejected submission is kept in history.

### Mini-Project Timeline View

```
Initial submission (by Student X, date)
  -> Evaluation: rejected (by Teacher Y, date)
     Feedback: "Wrong file uploaded"
  -> [submission reset]
New initial submission (by Student X, date)
  -> Evaluation: minor_revision (by Teacher Y, date)
     Feedback text: "Fix section 3"
     Feedback PDF: [download]
  -> Revised submission (by Student Z, date) [auto-accepted]
```

### Teacher Progress Dashboard

Part of the run management view, showing:
- **Completion overview:** table with each student/group, columns for each block's progress (items covered), color-coded
- **Quiz summary:** per-quiz average scores and pass rates
- **Mini-project status:** per-block summary — groups submitted, evaluated, pending
- **CSV export:** download progress data (student name, items covered per block, quiz scores, mini-project results)

### Bulk Operations (V1)

- **Roster:** add/remove multiple students, move students between groups
- **Export:** CSV download of progress and grades
- ZIP download of submitted reports: deferred to a later version

---

## 7. Notifications

### Architecture

FastAPI background tasks for immediate notifications + periodic scheduler (e.g., APScheduler) for deadline checks.

- **Immediate:** enrollment, evaluation received — triggered inline, sent in background
- **Scheduled:** deadline reminders, teacher summaries — hourly job checks deadlines and sends to relevant users

### Email

- SMTP with configurable host, port, encryption (none/starttls/ssl), username, password, from address
- Simple templates (plain text + minimal HTML) with placeholders
- `notification_log` table: who, what, when — prevents duplicates

### Notification Types

| Type | Trigger | Recipients |
|------|---------|------------|
| Enrollment | Student added to course/run | That student |
| Soft deadline approaching | 3 days before, scheduled | Run students in groups without submission |
| Hard deadline approaching | After soft deadline passes, scheduled | Same |
| Resubmission deadline approaching | 2 days before, scheduled | Students in groups with pending revision |
| Evaluation received | Teacher submits evaluation | All students in the group |
| Teacher summary | After soft deadline, scheduled | Run teachers |

### In-App Notifications

| Type | Trigger | Display |
|------|---------|---------|
| Version archived | Version state changes to archived | Banner in course view for enrolled students |

---

## 8. Frontend Architecture

Single Svelte 5.x application with three areas sharing auth and shell.

### Student View

- **Course list** (`/`): enrolled courses with progress indicators. If enrolled in multiple versions of the same course, routes to the latest.
- **Course page** (`/course-slug`): header with course info and course admin photos/names (as course creators/owners). Collapsible sidebar with block/sequence/item tree, main content area, item sequence bar. Archived version shows banner with link to newer version.
- **Item rendering**: static page (HTML), video (iframe embed), quiz (form + server evaluation + feedback after max attempts), interactive app (sandboxed iframe with JS)
- **Run view** (`/course-slug/run/{run-id}`): group members, run teacher photos/names, mini-project statuses, deadlines, submissions, evaluations

### Course Management

- **Dashboard** (`/manage/course-slug`): version list, roster management, run management
- **Content editor** (`/manage/course-slug/edit`): sidebar tree (draggable in created state), Markdown editor with live preview, quiz form builder (with optional explanation field per question), asset manager
- **Run management** (`/manage/course-slug/runs/{run-id}`): teacher assignment, groups, mini-projects, submissions overview, teacher progress dashboard, bulk roster operations, CSV export

### Superuser Panel

**Access:** The superuser panel is not permanently accessible. To activate it, run `mathion superuser` on the server, which generates a cryptographically random token (minimum 32 characters, URL-safe) and stores it hashed in the database. The panel is then available at `/superuser/{token}`. Access requires both the valid token AND an authenticated superuser session. The token expires after 30 minutes of inactivity (timer resets on each request). The token is also destroyed immediately if the superuser logs out manually. After expiry or logout, the token is deleted and the URL returns 404.

- **Dashboard** (`/superuser/{token}`): system overview stats (total users, courses, storage, active users in last 24h/7d based on `last_active_at`)
- **Users** (`/superuser/{token}/users`): list, search, create, deactivate, assign superuser
- **Courses** (`/superuser/{token}/courses`): create courses, assign admins (warning when adding second admin about concurrency)
- **Settings** (`/superuser/{token}/settings`): SMTP, file limits, session durations, system defaults
- **Setup checklist** (shown on first login until completed): configure SMTP, test email delivery, create first course

---

## 9. Deployment

### Docker Compose Stack

Three containers:
- **nginx**: reverse proxy, SSL termination, serves static frontend files
- **mathion-app**: FastAPI backend
- **postgres**: PostgreSQL database

Mounted volumes: `/data/mathion/assets/` (files), `/data/mathion/db/` (database)

### CLI Tool (`mathion`)

- `mathion install` — asks only for domain name and superuser email. Generates `docker-compose.yml` + `.env` with defaults, builds/pulls images, runs migrations, creates superuser account, generates and displays a one-time PIN for superuser login. All other settings (SMTP, file limits, etc.) configured via the superuser web panel after first login.
- `mathion superuserpin` — generates a new PIN for the superuser (same as email PIN: 6 digits, 10-minute expiry). Used for initial login, SMTP recovery, or anytime the superuser needs to log in without email.
- `mathion superuser` — activates the superuser panel by generating a unique URL token (30-minute inactivity timeout). Displays the full URL to access the panel.
- `mathion update` — pulls latest version, warns about migrations, creates backup, applies update, verifies health
- `mathion backup` — database dump + assets archive
- `mathion status` — containers, DB connection, disk usage, active users
- `mathion stop` / `mathion start` — stack control

### Configuration

Single `.env` file:

```
MATHION_DOMAIN=learn.myuniversity.edu
MATHION_DB_HOST=postgres
MATHION_DB_NAME=mathion
MATHION_DB_PASSWORD=<secret>
MATHION_SMTP_HOST=smtp.university.edu
MATHION_SMTP_PORT=587
MATHION_SMTP_ENCRYPTION=starttls
MATHION_SMTP_USERNAME=mathion
MATHION_SMTP_PASSWORD=<secret>
MATHION_SMTP_FROM=noreply@university.edu
MATHION_SECRET_KEY=<generated>
MATHION_ASSET_PATH=/data/mathion/assets
MATHION_MAX_FILE_SIZE=20971520
MATHION_MAX_COURSE_SIZE=524288000
```

---

## 10. Implementation Sequence

1. Core data model + API (courses, versions, blocks, sequences, items)
2. Auth + users (PIN login, roles, sessions)
3. Student course view (JSON delivery, navigation, content rendering)
4. Course editor (admin area, Markdown editing, live preview)
5. Quiz system (server-side evaluation, attempt tracking, feedback after max attempts)
6. Asset management (upload, serve, copy on version)
7. Runs + mini-projects (groups, deadlines, submissions, evaluation, teacher dashboard)
8. Superuser panel (system settings, monitoring, setup checklist)
9. Notifications (email sending, in-app banners)
10. Deployment (Docker, CLI tool)
