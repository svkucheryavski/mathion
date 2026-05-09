import type { Route } from './lib/router.svelte';

export const routes: Route[] = [
  { path: '/login', component: 'Login', auth: false },
  { path: '/courses', component: 'CourseList', auth: true },
  { path: '/courses/:courseSlug', component: 'CourseView', auth: true },
  { path: '/courses/:courseSlug/seq/:sequenceId', component: 'SequencePlayer', auth: true },
  { path: '/courses/:courseSlug/edit', component: 'VersionsPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'BlockEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'SequenceEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId', component: 'ItemEditPage', auth: true },
];
