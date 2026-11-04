import { api, ApiError, OFFLINE_MESSAGE } from './api';

// Every panel call passes skipAuthRedirect: the panel's shell handles 401 and
// 404 itself (panelError), instead of the app-wide onUnauthorized redirect.
const opts = { skipAuthRedirect: true };
const base = (token: string) => `/api/superuser/${token}`;

export type SuperuserStats = {
  total_users: number;
  total_courses: number;
  storage_bytes: number;
  active_users_24h: number;
  active_users_7d: number;
};

export function getSuperuserStats(token: string): Promise<SuperuserStats> {
  return api.get<SuperuserStats>(`${base(token)}/stats`, opts);
}

// --- Courses (spec D4-D13), mirroring backend/mathion/schemas.py ---

export type PanelAdmin = { id: number; email: string; full_name: string | null; is_disabled: boolean };

export type PanelCourse = {
  id: number;
  name: string;
  slug: string;
  admin: PanelAdmin | null;
  version_count: number;
  run_count: number;
  student_count: number;
};

/** D5a: what happened to the admin email; the first that applies wins. */
export type AdminEmail = 'queued' | 'email_off' | 'disabled' | 'unchanged';

export type AdminAssignResult = {
  course: PanelCourse;
  admin: PanelAdmin;
  admin_email: AdminEmail;
  pin_minutes: number;
  sign_in_url: string;
};

export type AccountLookup = { status: 'new' | 'existing' | 'disabled'; full_name: string | null };

export type CourseDeleteImpact = { progress_students: number };

export function listCourses(token: string): Promise<PanelCourse[]> {
  return api.get<PanelCourse[]>(`${base(token)}/courses`, opts);
}

export function createCourse(token: string, body: { name: string; slug: string; admin_email: string }): Promise<AdminAssignResult> {
  return api.post<AdminAssignResult>(`${base(token)}/courses`, body, opts);
}

export function updateCourse(token: string, id: number, body: { name?: string; slug?: string }): Promise<PanelCourse> {
  return api.patch<PanelCourse>(`${base(token)}/courses/${id}`, body, opts);
}

export function assignAdmin(token: string, id: number, email: string): Promise<AdminAssignResult> {
  return api.put<AdminAssignResult>(`${base(token)}/courses/${id}/admin`, { email }, opts);
}

export function removeAdmin(token: string, id: number): Promise<void> {
  return api.delete(`${base(token)}/courses/${id}/admin`, opts);
}

export function getDeleteImpact(token: string, id: number): Promise<CourseDeleteImpact> {
  return api.get<CourseDeleteImpact>(`${base(token)}/courses/${id}/delete-impact`, opts);
}

export function deleteCourse(token: string, id: number): Promise<void> {
  return api.delete(`${base(token)}/courses/${id}`, opts);
}

export function lookupAccount(token: string, email: string): Promise<AccountLookup> {
  return api.post<AccountLookup>(`${base(token)}/accounts/lookup`, { email }, opts);
}

/** The `mathion pin` command the email-off note gives (D5a); the page shows it as code. */
export const pinCommand = (email: string) => `mathion pin ${email}`;

/**
 * D5a: the note after New course (`create`) or an admin assign (`assign`). It
 * opens with the result, naming the admin by name or, without one, by email
 * (Review Focus 4); "unchanged" says only that nothing changed.
 */
export function adminNote(result: AdminAssignResult, kind: 'create' | 'assign'): string {
  const { course, admin } = result;
  if (result.admin_email === 'unchanged') return 'They are already the admin; nothing changed.';
  const who = admin.full_name ?? admin.email;
  const opening = kind === 'create'
    ? `${course.name} is created; ${who} is its admin.`
    : `${who} is now the admin of ${course.name}.`;
  switch (result.admin_email) {
    case 'queued':
      return `${opening} An email with a sign-in link is on its way to ${admin.email}.`;
    case 'disabled':
      return `${opening} No email sent: this account is disabled. Enable it on the Users page so they can sign in.`;
    case 'email_off': {
      const minutes = `${result.pin_minutes} minute${result.pin_minutes === 1 ? '' : 's'}`;
      return `${opening} Email isn't set up on this server, so tell them yourself. They sign in at ${result.sign_in_url} `
        + `with a PIN: run ${pinCommand(admin.email)} on the server (the PIN lasts ${minutes}).`;
    }
  }
}

// --- Users (spec D14-D21) ---

export type PanelUserRole = 'all' | 'admins' | 'teachers' | 'students' | 'disabled';

export type PanelCourseRef = { id: number; name: string };
/** A run as a Users row lists it on hover: "<course> · <run title>" (D14 rev 8). */
export type PanelRunRef = { id: number; title: string; course_name: string };

export type PanelUser = {
  id: number;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
  is_disabled: boolean;
  created_at: string;
  last_seen_at: string | null;
  admin_of: PanelCourseRef[];
  teacher_runs: PanelRunRef[];
  student_runs: PanelRunRef[];
  /** D20: any reference that blocks the delete. */
  has_data: boolean;
};

export type PanelUserCounts = Record<PanelUserRole, number>;

/** `users` is at most 20; `total` counts the pill and the search; `counts` never follow the search (D15a). */
export type PanelUserList = { users: PanelUser[]; total: number; counts: PanelUserCounts };

export function listUsers(token: string, q: string, role: PanelUserRole): Promise<PanelUserList> {
  return api.get<PanelUserList>(`${base(token)}/users?${new URLSearchParams({ q, role })}`, opts);
}

export function createUser(token: string, body: { email: string; full_name?: string | null }): Promise<PanelUser> {
  return api.post<PanelUser>(`${base(token)}/users`, body, opts);
}

/** Only the fields sent change; `full_name: null` clears the name. */
export function updateUser(token: string, id: number, body: { full_name?: string | null; email?: string }): Promise<PanelUser> {
  return api.patch<PanelUser>(`${base(token)}/users/${id}`, body, opts);
}

export function disableUser(token: string, id: number): Promise<PanelUser> {
  return api.post<PanelUser>(`${base(token)}/users/${id}/disable`, undefined, opts);
}

export function enableUser(token: string, id: number): Promise<PanelUser> {
  return api.post<PanelUser>(`${base(token)}/users/${id}/enable`, undefined, opts);
}

export function deleteUser(token: string, id: number): Promise<void> {
  return api.delete(`${base(token)}/users/${id}`, opts);
}

const NOUNS: Record<PanelUserRole, [string, string]> = {
  all: ['account', 'accounts'],
  admins: ['admin', 'admins'],
  teachers: ['teacher', 'teachers'],
  students: ['student', 'students'],
  disabled: ['disabled account', 'disabled accounts'],
};
const noun = (role: PanelUserRole, n: number) => NOUNS[role][n === 1 ? 0 : 1];
const runs = (n: number) => `${n} ${n === 1 ? 'run' : 'runs'}`;

/** D15: the line under the table, for the list as fetched with its pill and search. */
export function countLine(list: PanelUserList, role: PanelUserRole, searching: boolean): string {
  const shown = list.users.length;
  const total = list.total;
  if (searching) {
    if (total === 0) return `No ${noun(role, 0)} match`;
    return total > shown ? `${shown} of ${total} match. Keep typing to narrow.` : `${total} match`;
  }
  if (total === 0) return `No ${noun(role, 0)}`;
  return total > shown
    ? `Showing the ${shown} newest of ${total} ${noun(role, total)}. Search to find others.`
    : `${total} ${noun(role, total)}`;
}

/** A role chip: short text, the full list for a screen reader (D14 rev 8),
 *  and the capped hover text, '' for none (D14 rev 9). */
export type RoleChip = { kind: 'su' | 'ad' | 'role'; text: string; items: string[]; tip: string };

const TIP_LINES = 10;

// Cut by characters, not UTF-16 units, so a cut never splits one in two.
function cut(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

// D14 rev 9: "- " lines, at most ten, then "… and N more" with no bullet.
function tip(lines: string[]): string {
  const shown = lines.slice(0, TIP_LINES).map((l) => `- ${l}`);
  if (lines.length > TIP_LINES) shown.push(`… and ${lines.length - TIP_LINES} more`);
  return shown.join('\n');
}

/** D14 rev 8: one short chip per role, the count in brackets, in D14 order;
 *  [] for an account with no role. Disabled is not a chip: the row is greyed. */
export function roleChips(u: PanelUser): RoleChip[] {
  const chips: RoleChip[] = [];
  const named = (r: PanelRunRef) => `${r.course_name} · ${r.title}`;
  // Course and run are cut apart, so a long course never hides the run title.
  const short = (r: PanelRunRef) => `${cut(r.course_name, 24)} · ${cut(r.title, 20)}`;
  const runChip = (role: string, runs: PanelRunRef[]): RoleChip =>
    ({ kind: 'role', text: `${role} (${runs.length})`, items: runs.map(named), tip: tip(runs.map(short)) });
  if (u.is_superuser) chips.push({ kind: 'su', text: 'Superuser', items: [], tip: '' });
  if (u.admin_of.length) {
    const names = u.admin_of.map((c) => c.name);
    chips.push({ kind: 'ad', text: `Admin (${names.length})`, items: names, tip: tip(names.map((n) => cut(n, 30))) });
  }
  if (u.teacher_runs.length) chips.push(runChip('Teacher', u.teacher_runs));
  if (u.student_runs.length) chips.push(runChip('Student', u.student_runs));
  return chips;
}

/** An account as the panel names it: the name, or the email when there is none. */
export const personName = (u: PanelUser) => u.full_name ?? u.email;

/** D18: what the person loses, without she or he (Mathion stores no gender). */
export function disableWarning(u: PanelUser): string {
  const who = personName(u);
  const parts: string[] = [];
  const courses = u.admin_of.map((c) => c.name);
  if (courses.length > 2) parts.push(`is the admin of ${courses.length} courses`);
  else if (courses.length > 0) parts.push(`is the admin of ${courses.join(' and ')}`);
  if (u.teacher_runs.length) parts.push(`teaches ${runs(u.teacher_runs.length)}`);
  const middle = parts.length ? `${who} ${parts.join(' and ')}. ` : '';
  return `Disable ${who}? ${middle}They'll be signed out and can't sign in until enabled; tell them yourself.`;
}

// --- The shell (D23, D25) ---

/** The panel's three pages; the shell reads it from the route. */
export type PanelPage = 'dashboard' | 'users' | 'courses';

// --- Errors (D25) ---

/** The shell's handler for the guard's answers: 401 → sign in, 404 → the link expired. */
export type PanelOnAuth = (kind: 'signin' | 'expired') => void;

/**
 * What a panel page shows for a failed call. The guard's 401 and 404 go to
 * `onAuth` and show nothing here (null). Otherwise the server's sentence as it
 * is (D25): a 409's detail, or a 422's first msg without pydantic's
 * "Value error, " prefix (the backend validators raise plain sentences).
 */
export function panelError(err: unknown, onAuth: PanelOnAuth): string | null {
  if (err instanceof ApiError) {
    if (err.status === 401) { onAuth('signin'); return null; }
    if (err.status === 404) { onAuth('expired'); return null; }
    const first = err.validationErrors()?.[0]?.msg;
    if (first) return first.replace(/^Value error, /, '');
    return err.displayMessage;
  }
  if (err instanceof TypeError) return OFFLINE_MESSAGE;
  return 'Something went wrong. Try again.';
}
