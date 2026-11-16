<script lang="ts">
  // D8: New course — name, address (from the name, D13) and the admin's email
  // (required). `onSave` owns the request, closes on success and THROWS on
  // failure; the server's sentence shows here with every field kept (D25).
  // The form and its fields are shared with Set up's First course step.
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import CourseFields from './fields/CourseFields.svelte';
  import { CourseForm, type CourseBody } from '../../lib/panelForms/courseForm.svelte';
  import { panelError, panelErrorField, type PanelOnAuth } from '../../lib/superuser';

  type Props = { token: string; onSave: (body: CourseBody) => Promise<void>; onClose: () => void; onAuth: PanelOnAuth };
  let { token, onSave, onClose, onAuth }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const errId = `${uid}-err`;

  const form = new CourseForm();
  let busy = $state(false);

  // A 422 naming a field ties the sentence to that field, not the form.
  const onField = $derived(['name', 'slug', 'admin_email'].includes(form.errorField ?? ''));

  async function save() {
    if (busy || !form.ready) return;
    form.error = null;
    busy = true;
    try {
      await onSave(form.body());
    } catch (e) {
      form.error = panelError(e, onAuth);
      form.errorField = panelErrorField(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet head()}
  <h2 id={titleId} class="nc-title">New course</h2>
{/snippet}

{#snippet foot()}
  <span class="spacer" aria-hidden="true"></span>
  <Button variant="ghost" disabled={busy} onclick={onClose}>Cancel</Button>
  <Button variant="primary" loading={busy} aria-disabled={!form.ready && !busy} onclick={() => void save()}>Create</Button>
{/snippet}

<Modal labelledby={titleId} width={480} maxHeight={520} onRequestClose={onClose} closeDisabled={busy} header={head} footer={foot}>
  <form class="nc-form" novalidate aria-describedby={form.error && !onField ? errId : undefined}
    onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <CourseFields {form} {uid} {busy} {token} {onAuth} {errId} />
    {#if form.error}<p id={errId} class="nc-err" role="alert">{form.error}</p>{/if}
    <!-- Enter in a field submits. -->
    <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
  </form>
</Modal>

<style>
  .nc-title { margin: 0; flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
  .spacer { flex: 1; }
  .nc-form { display: flex; flex-direction: column; gap: 6px; }
  .nc-err { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
