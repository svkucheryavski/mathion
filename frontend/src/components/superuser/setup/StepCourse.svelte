<script lang="ts">
  // Set up D8: step 3, New course's three fields (Users/Courses D8, D13). Save
  // and continue creates the course; the step then shows the Courses page's
  // note (whether the admin was told, or how they sign in) and only Continue.
  // "Step 3 saved" goes out at once, while the note shows; its answer updates
  // the list's marks but never the card (D3a): the note holds it. Continue
  // then shows the step the newest state names, or retries a failed "step 3
  // saved". A step that is done shows the done view (the course, its admin,
  // and the sign-in sentence a reload must not lose) and Continue, unless the
  // form holds typed values (D3a). A 409 re-reads the state: if step 3 is now
  // done, the done view replaces the form and its values, or All set shows
  // when the wizard is now over.
  import { getContext, onDestroy, untrack } from 'svelte';
  import StepCard from './StepCard.svelte';
  import CourseFields from '../fields/CourseFields.svelte';
  import NoteStrip from '../NoteStrip.svelte';
  import CommandText from '../CommandText.svelte';
  import { CourseForm } from '../../../lib/panelForms/courseForm.svelte';
  import { ApiError } from '../../../lib/api';
  import { adminNoteParts, createCourse, panelError } from '../../../lib/superuser';
  import { doneViewNote, setupSaved, type PanelSetup, type StepProps } from '../../../lib/setup';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../../lib/dirtyRegistry.svelte';

  let { token, setup, onAuth, me, onDone, back, skip, moveError, onHold }: StepProps = $props();

  const uid = $props.id();
  let form = $state.raw(new CourseForm());
  /** The note after Save (D8); it holds the card until the person moves on. */
  let note = $state<{ text: string; command?: string } | null>(null);
  /** "Step 3 saved" answered for the note, so Continue sends nothing (D8). */
  let savedOk = $state(false);

  const busy = $derived(setup.busy || setup.saving);
  const done = $derived(setup.state?.steps[2]?.done ?? false);
  // D8, D3a: the done view follows the state while the form holds nothing
  // typed, so a re-read never swaps out typed values; its own errors (a failed
  // Continue, a 409's sentence) show in it.
  const doneText = $derived(setup.state && done && !form.changed ? doneViewNote(setup.state, me) : null);
  const doneView = $derived(doneText !== null);
  const noAdmin = $derived(setup.state?.course_without_admin ?? null);
  const mode = $derived(note || doneView ? 'continue' : 'save');

  // D3: unsaved changes ask before leaving; Discard empties the form.
  const tracker = {
    get isDirty() { return form.changed; },
    discard: () => { form = new CourseForm(); },
  };
  const registry = getContext<DirtyRegistry | undefined>(DIRTY_REGISTRY_KEY);
  $effect(() => {
    registry?.register(tracker);
    return () => registry?.unregister(tracker);
  });
  // A failed move's sentence is the newest: it replaces the step's own error.
  $effect(() => {
    if (moveError !== null) untrack(() => { form.error = null; });
  });
  // Told once, when the step opens; the page reads it at each re-read (D3a).
  untrack(() => onHold(() => note !== null || !!form.error || tracker.isDirty));
  // D3a: typed values keep the link alive while the step is open.
  onDestroy(untrack(() => setup.keepAlive(() => tracker.isDirty)));

  /** "Step 3 saved": its answer, or null. A failure shows in the card and
   *  re-reads the state, so the marks follow the course (D13). */
  async function sendSaved(): Promise<PanelSetup | null> {
    form.error = null;
    try {
      return await setup.write(() => setupSaved(token, 3));
    } catch (e) {
      const message = panelError(e, onAuth);
      form.error = message;
      if (message !== null) void setup.read();
      return null;
    }
  }

  async function onCreate(): Promise<void> {
    if (!form.ready) return;
    form.error = null;
    setup.saving = true;
    try {
      const result = await createCourse(token, form.body());
      const emailReason = setup.state?.steps[0]?.reason ?? null;   // null once Email is done
      note = adminNoteParts(result, 'create', { me, emailReason });
      form = new CourseForm();
    } catch (e) {
      const message = panelError(e, onAuth);
      form.error = message;
      // D8: a 409 (the address is taken, say in another tab) re-reads; if
      // step 3 is now done, the done view replaces the form and its values.
      if (e instanceof ApiError && e.status === 409) {
        const s = await setup.read();
        if (s?.steps[2]?.done && s.course) {
          // D3a: or the All set card, if the wizard is now over.
          if (!s.wizard_on) { form = new CourseForm(); onDone(s); return; }
          form = new CourseForm();
          form.error = message;
        }
      }
      return;
    } finally {
      setup.saving = false;
    }
    // D8: sent while the note shows; its answer never moves the card.
    savedOk = (await sendSaved()) !== null;
  }

  async function onContinue(): Promise<void> {
    // D3a: the note's Continue shows the newest state's step, or retries.
    if (note && savedOk && setup.state) { onDone(setup.state); return; }
    const s = await sendSaved();
    if (s) onDone(s);
  }

  function onSave(): void {
    if (busy) return;
    void (mode === 'continue' ? onContinue() : onCreate());
  }
</script>

<StepCard n={3} title="First course and its admin" note="A course and the person who will build it."
  error={form.error ?? moveError} {busy} {mode} canSave={form.ready}
  onBack={note ? undefined : back} onSkip={note || done ? undefined : skip} {onSave}>
  {#if note}
    <NoteStrip tone="info"><CommandText text={note.text} command={note.command} /></NoteStrip>
  {:else if doneText}
    <p class="sc-done"><CommandText text={doneText.text} command={doneText.command} /></p>
  {:else}
    {#if noAdmin}<p class="sc-line">{noAdmin} has no admin: give it one on the Courses page, or create another course here.</p>{/if}
    <!-- D3a: every edit notes the time for the keep-alive. The lead-in stays
         outside the fields' parent (their labels' :not(:first-child) margins). -->
    <div class="sc-fields" oninput={() => setup.noteEdit()} onchange={() => setup.noteEdit()} role="presentation">
      <CourseFields {form} {uid} {busy} {token} {onAuth} />
    </div>
  {/if}
</StepCard>

<style>
  .sc-fields { display: flex; flex-direction: column; gap: 6px; }
  .sc-line { margin: 0; font-size: 12.5px; color: var(--gold-text); }
  .sc-done { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text); overflow-wrap: anywhere; }
</style>
