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

export type PanelUser = {
  id: number;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
  is_disabled: boolean;
  created_at: string;
  last_seen_at: string | null;
  admin_of: PanelCourseRef[];
  teacher_runs: number;
  student_runs: number;
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
