import type { Attachment } from 'svelte/attachments';

// Settings D9: a test's answer or a save's error can land below the fold of a
// scrolling dialog body or page; bring it into view, moving as little as it
// can. An attachment factory: `{@attach scrollIntoSight(message)}` runs again
// when the message changes, also when the box stays in place.
export function scrollIntoSight(_message: unknown): Attachment {
  return (node) => node.scrollIntoView?.({ block: 'nearest' });
}
