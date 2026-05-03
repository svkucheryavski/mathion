import type { Route } from './lib/router.svelte';

export const routes: Route[] = [
  { path: '/login', component: 'Login', auth: false },
  { path: '/courses', component: 'CourseList', auth: true },
  { path: '/courses/:courseSlug', component: 'CourseView', auth: true },
  { path: '/courses/:courseSlug/seq/:sequenceId', component: 'SequencePlayer', auth: true },
];
