import type { Route } from './lib/router.svelte';

export const routes: Route[] = [
  { path: '/login', component: 'Login', auth: false },
  { path: '/courses', component: 'CourseList', auth: true },
  { path: '/teaching', component: 'TeacherRunListPage', auth: true },
  { path: '/courses/:courseSlug', component: 'CourseView', auth: true },
  { path: '/courses/:courseSlug/seq/:sequenceId', component: 'SequencePlayer', auth: true },
  { path: '/courses/:courseSlug/blocks/:blockSlug/mini-project', component: 'MiniProjectDetailPage', auth: true },
  { path: '/courses/:courseSlug/edit', component: 'VersionsPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/runs', component: 'RunsRedirect', auth: true },
  { path: '/courses/:courseSlug/runs/:runId', component: 'RunsRedirect', auth: true },
  { path: '/teaching/:courseSlug', component: 'RunListPage', auth: true },
  { path: '/teaching/:courseSlug/runs/:runId', component: 'RunDetailPage', auth: true },
  { path: '/superuser/:token', component: 'SuperuserShell', auth: false },
  { path: '/superuser/:token/users', component: 'SuperuserShell', auth: false },
  { path: '/superuser/:token/courses', component: 'SuperuserShell', auth: false },
];
