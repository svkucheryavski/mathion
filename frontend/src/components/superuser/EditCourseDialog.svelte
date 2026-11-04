<script lang="ts">
  // D24 (rev 6): one Edit dialog for a course — name, address and the admin's
  // email (D9-D11). Save sends only what changed: the name and address first
  // (`saveFields`), then the admin (`saveAdmin`; null removes them). Each step
  // THROWS on failure and the server's sentence shows here (D25). What already
  // saved becomes the new starting point, so Save retries only the rest.
  // `onDone` runs once every step has saved.
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import AdminEmailField from './AdminEmailField.svelte';
  import { panelError, type PanelCourse, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    token: string;
    course: PanelCourse;
    saveFields: (body: { name?: string; slug?: string }) => Promise<void>;
    saveAdmin: (email: string | null) => Promise<void>;
    onDone: () => void;
    onClose: () => void;
    onAuth: PanelOnAuth;
  };
  let { token, course, saveFields, saveAdmin, onDone, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  // The saved values; a step that succeeds moves them on.
  let saved = $state(untrack(() => ({ name: course.name, slug: course.slug, email: course.admin?.email ?? '' })));
  let name = $state(untrack(() => saved.name));
  let slug = $state(untrack(() => saved.slug));
  let email = $state(untrack(() => saved.email));
  let error = $state<string | null>(null);
  let busy = $state(false);

  const nameChanged = $derived(name.trim() !== saved.name);
  const slugChanged = $derived(slug.trim() !== saved.slug);
  const emailChanged = $derived(email.trim() !== saved.email);
  const ready = $derived((nameChanged || slugChanged || emailChanged) && name.trim() !== '' && slug.trim() !== '');
  const removing = $derived(saved.email !== '' && email.trim() === '');

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  // D11 rev 10: a course with no runs and no students (one just created) gives no counts.
  const warning = $derived(
    course.run_count === 0 && course.student_count === 0
      ? 'Links people saved or shared with the old address will stop working.'
      : `Links people saved or shared with the old address will stop working: ${plural(course.run_count, 'run', 'runs')}, ${plural(course.student_count, 'student', 'students')}.`,
  );

  async function save() {
    if (busy || !ready) return;
    error = null;
    busy = true;
    try {
      if (nameChanged || slugChanged) {
        const body: { name?: string; slug?: string } = {};
        if (nameChanged) body.name = name.trim();
        if (slugChanged) body.slug = slug.trim();
        await saveFields(body);
        saved = { ...saved, name: name.trim(), slug: slug.trim() };
      }
      if (emailChanged) {
        const next = email.trim();
        await saveAdmin(next === '' ? null : next);
        saved = { ...saved, email: next };
      }
      onDone();
    } catch (e) {
      error = panelError(e, onAuth);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="ec-title">Edit course</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <!-- Blocked, not disabled, so focus stays on it; save() returns at once. -->
  <Button variant="primary" loading={busy} aria-disabled={!ready && !busy} onclick={() => void save()}>Save</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={560} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <!-- novalidate: the server's sentence is the check (type="email" would block Enter). -->
  <form class="ec-form" novalidate aria-describedby={error ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label class="ec-label" for="{uid}-name">Course name</label>
    <input id="{uid}-name" class="ec-input" data-autofocus bind:value={name} readonly={busy} autocomplete="off"
      oninput={() => { error = null; }} />
    <label class="ec-label" for="{uid}-slug">Address</label>
    <input id="{uid}-slug" class="ec-input ec-mono" bind:value={slug} readonly={busy} autocomplete="off" spellcheck="false"
      oninput={() => { error = null; }} />
    {#if slugChanged}<p class="ec-note">{warning}</p>{/if}
    <label class="ec-label" for="{uid}-email">Admin's email</label>
    <AdminEmailField id="{uid}-email" {token} value={email} {onAuth} readonly={busy}
      oninput={(v) => { email = v; error = null; }} />
    {#if removing}<p class="ec-note">{saved.name} will have no admin.</p>{/if}
    {#if error}<p id={errId} class="ec-err" role="alert">{error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .ec-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .ec-form { display: flex; flex-direction: column; gap: 6px; }
  .ec-label { font-size: 12.5px; color: var(--muted); }
  .ec-label:not(:first-child) { margin-top: 6px; }
  /* The item modal's field (NewItemModal .plain-input). */
  .ec-input {
    box-sizing: border-box;
    width: 100%;
    height: var(--control-h);
    padding: 0 var(--control-pad-x);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
    font-size: var(--control-font);
    caret-color: var(--primary);
  }
  .ec-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .ec-mono { font-family: var(--font-mono); }
  .ec-note { margin: 0; font-size: 12.5px; color: var(--text-2); }
  .ec-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
