<script lang="ts">
  // The admin's email (D8, D9) and its hint under it: whether an account will
  // be created, or that it is disabled; nothing for an existing account. It
  // asks after a 250 ms pause, and only the newest reply counts. A failed
  // lookup shows no hint (the save answers for itself); the guard's 401/404
  // still go to the shell. The parent owns the value and the label (`id`).
  import { lookupAccount, panelError, type PanelOnAuth } from '../../lib/superuser';

  type Props = {
    token: string;
    value: string;
    onAuth: PanelOnAuth;
    oninput: (v: string) => void;
    id: string;
    readonly?: boolean;
  };
  let { token, value, onAuth, oninput, id, readonly = false }: Props = $props();

  const NEW = 'No account yet: one will be created.';
  const DISABLED = "This account is disabled: they can't sign in until you enable it.";
  const SHAPE = /^[^@\s]+@[^@\s]+$/;

  let hint = $state('');
  let latest = 0;

  $effect(() => {
    const email = value.trim();
    const t = token;
    const mine = ++latest;
    hint = '';
    if (!SHAPE.test(email)) return;
    const timer = setTimeout(async () => {
      try {
        const found = await lookupAccount(t, email);
        if (mine !== latest) return;
        hint = found.status === 'new' ? NEW : found.status === 'disabled' ? DISABLED : '';
      } catch (err) {
        if (mine === latest) panelError(err, onAuth);
      }
    }, 250);
    return () => clearTimeout(timer);
  });
</script>

<input {id} class="ae-input" type="email" {value} {readonly} autocomplete="off" spellcheck="false"
  oninput={(e) => oninput(e.currentTarget.value)} />
<!-- Always present, so a screen reader hears the hint when it arrives. -->
<p class="account-hint" aria-live="polite">{hint}</p>

<style>
  /* The item modal's field (NewItemModal .plain-input). */
  .ae-input {
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
  .ae-input:focus-visible { outline: none; border: 1.5px solid var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
  .account-hint { margin: 0; font-size: 12px; color: var(--muted); }
  .account-hint:empty { display: none; }
</style>
