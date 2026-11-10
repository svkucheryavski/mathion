// Users/Courses D8, D13: a new course's name, address (from the name) and its
// admin's email (required).
import { PanelForm } from './formBase.svelte';
import { slugFromName } from '../slugify';

export type CourseBody = { name: string; slug: string; admin_email: string };

export class CourseForm extends PanelForm {
  constructor() {
    super(undefined);
  }

  name = $state('');
  slug = $state('');
  // D13: the address follows the name until the superuser edits it.
  slugEdited = $state(false);
  email = $state('');

  readonly changed = $derived(this.name !== '' || this.slug !== '' || this.email !== '');
  readonly ready = $derived(this.name.trim() !== '' && this.slug.trim() !== '' && this.email.trim() !== '');

  onName(): void {
    this.edited();
    if (!this.slugEdited) this.slug = slugFromName(this.name);
  }

  onSlug(): void {
    this.slugEdited = true;
    this.edited();
  }

  body(): CourseBody {
    return { name: this.name.trim(), slug: this.slug.trim(), admin_email: this.email.trim() };
  }
}
