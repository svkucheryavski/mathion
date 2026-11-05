<script lang="ts">
  // Settings D4-D6: four cards (Email, File limits, Sign-in, Site). Each lists
  // its values; one pencil per card opens one Edit dialog (D5). A save shows
  // the saved values the server answers with. Site has no pencil (D3).
  import {
    getSettings, saveEmail, saveLimits, saveSignIn, testEmail, panelError,
    type Encryption, type PanelEmailSettings, type PanelOnAuth, type PanelSettings,
  } from '../../lib/superuser';
  import { formatDayTime } from '../../lib/datetime';
  import PanelHead from '../../components/superuser/PanelHead.svelte';
  import EditEmailDialog from '../../components/superuser/EditEmailDialog.svelte';
  import EditLimitsDialog from '../../components/superuser/EditLimitsDialog.svelte';
  import EditSignInDialog from '../../components/superuser/EditSignInDialog.svelte';
  import IconButton from '../../components/ui/IconButton.svelte';
  import Skeleton from '../../components/ui/Skeleton.svelte';
  import ErrorState from '../../components/ui/ErrorState.svelte';

  let { token, onAuth }: { token: string; onAuth: PanelOnAuth } = $props();

  let settings = $state.raw<PanelSettings | null>(null);
  let loading = $state(true);
  let loadError = $state('');
  let dialog = $state<'email' | 'limits' | 'sign-in' | null>(null);

  // `quiet` reloads behind what is on screen and keeps it if it fails.
  async function load(quiet = false): Promise<void> {
    if (!quiet) { loading = true; loadError = ''; }
    try {
      settings = await getSettings(token);
      loadError = '';
    } catch (err) {
      const msg = panelError(err, onAuth);
      if (!quiet) loadError = msg ?? '';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // D9a: a test of the saved values reaches the card on the server, so closing
  // the email dialog, saved or not, reloads behind it.
  function closeEmail(): void {
    dialog = null;
    void load(true);
  }

  const ENCRYPTION: Record<Encryption, string> = { starttls: 'STARTTLS', ssl: 'SSL/TLS', none: 'no encryption' };
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  function login(e: PanelEmailSettings): string {
    if (e.username === '') return 'No login';
    if (e.password_unreadable) return `${e.username}, password can't be read`;
    return `${e.username}, ${e.password_saved ? 'password saved' : 'no password saved'}`;
  }
</script>

{#snippet pencil(label: string, kind: 'email' | 'limits' | 'sign-in')}
  <IconButton glyph="pencil" size="md" title="Edit" aria-label={label} data-action="edit" onclick={() => (dialog = kind)} />
{/snippet}

<div class="s-page">
  <PanelHead title="Settings" />

  {#if loading}
    <Skeleton rows={4} label="Loading settings…" />
  {:else if loadError || !settings}
    <ErrorState title="Could not load settings." message={loadError} onretry={() => void load()} retryLabel="Try again" />
  {:else}
    {@const e = settings.email}
    <section class="s-card" aria-labelledby="s-email">
      <div class="s-card-head">
        <h2 id="s-email">Email</h2>
        {#if !e.dev_mode}
          <span class="s-badge" class:on={e.on} class:off={!e.on}>{e.on ? 'On' : 'Off'}</span>
          {@render pencil('Edit email', 'email')}
        {/if}
      </div>
      {#if e.dev_mode}
        <p class="s-foot s-alone">Email goes to a developer outbox (set on the server).</p>
      {:else if !e.on}
        <p class="s-foot s-alone">Email is off: sign-in PINs and notifications aren't sent.<br />People can sign in only with a PIN you make on the server (<code>mathion pin &lt;email&gt;</code>).</p>
      {:else}
        <dl>
          <dt>Mail server</dt>
          <dd><span class="mono">{e.host}:{e.port}</span>, {ENCRYPTION[e.encryption]}{e.skip_cert_check ? ', certificate not checked' : ''}</dd>
          <dt>Login</dt>
          <dd>{login(e)}</dd>
          <dt>From</dt>
          <dd>{e.from_address}</dd>
          {#if e.card_test}
            {@const t = e.card_test}
            <dt>Last test</dt>
            <dd class={t.ok ? 'ok' : 'err'}>{t.ok ? `Sent, ${formatDayTime(t.at)}` : `Failed, ${formatDayTime(t.at)}: ${t.message}`}</dd>
          {/if}
        </dl>
        {#if e.failing}
          <p class="s-failing err">Sending is failing since {formatDayTime(e.failing.since)}: {e.failing.message}</p>
        {/if}
      {/if}
    </section>

    <section class="s-card" aria-labelledby="s-limits">
      <div class="s-card-head">
        <h2 id="s-limits">File limits</h2>
        {@render pencil('Edit file limits', 'limits')}
      </div>
      <dl>
        <dt>Largest file</dt>
        <dd>{settings.limits.max_file_mb} MB</dd>
        <dt>Files per course version or run</dt>
        <dd>{settings.limits.max_total_mb} MB in total</dd>
      </dl>
    </section>

    <section class="s-card" aria-labelledby="s-sign-in">
      <div class="s-card-head">
        <h2 id="s-sign-in">Sign-in</h2>
        {@render pencil('Edit sign-in', 'sign-in')}
      </div>
      <dl>
        <dt>A PIN lasts</dt>
        <dd>{plural(settings.sign_in.pin_minutes, 'minute', 'minutes')}</dd>
        <dt>PIN requests</dt>
        <dd>{settings.sign_in.pin_requests_per_hour} per hour</dd>
        <dt>Wrong PIN tries</dt>
        <dd>{settings.sign_in.pin_failures_per_hour} per hour</dd>
        <dt>Longest sign-in</dt>
        <dd>{plural(settings.sign_in.longest_sign_in_days, 'day', 'days')}</dd>
      </dl>
    </section>

    <section class="s-card" aria-labelledby="s-site">
      <div class="s-card-head">
        <h2 id="s-site">Site</h2>
      </div>
      <dl>
        <dt>Address</dt>
        <dd class="mono">{settings.site.base_url}</dd>
      </dl>
      <p class="s-foot">Set on the server, because every link Mathion sends is built from it.</p>
    </section>

    {#if dialog === 'email'}
      <EditEmailDialog email={settings.email} {onAuth} onClose={closeEmail} onDone={closeEmail}
        save={async (body) => { settings = await saveEmail(token, body); }}
        test={(body) => testEmail(token, body)} />
    {:else if dialog === 'limits'}
      <EditLimitsDialog limits={settings.limits} {onAuth} onClose={() => (dialog = null)} onDone={() => (dialog = null)}
        save={async (body) => { settings = await saveLimits(token, body); }} />
    {:else if dialog === 'sign-in'}
      <EditSignInDialog signIn={settings.sign_in} {onAuth} onClose={() => (dialog = null)} onDone={() => (dialog = null)}
        save={async (body) => { settings = await saveSignIn(token, body); }} />
    {/if}
  {/if}
</div>

<style>
  /* The mockup's column: cards read as a form, not a full-width table. */
  .s-page { max-width: 760px; }
  .s-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); margin: 0 0 14px; }
  .s-card-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--border); }
  /* As tall as the pencil, so a head without one (Site, a dev mode) is the same height. */
  .s-card-head h2 { flex: 1; margin: 0; font-size: 15px; line-height: 28px; font-weight: 600; color: var(--text); }
  .s-badge { font-size: 11.5px; font-weight: 500; padding: 1px 7px; border-radius: 3px; }
  .s-badge.on { background: var(--status-accepted-bg); color: var(--status-accepted-fg); }
  .s-badge.off { background: var(--surface-2); color: var(--muted); }
  dl { display: grid; grid-template-columns: 210px 1fr; margin: 0; padding: 6px 16px 10px; font-size: 13px; }
  dt { padding: 5px 0; color: var(--muted); }
  dd { margin: 0; padding: 5px 0; color: var(--text); overflow-wrap: anywhere; }
  .mono { font-family: var(--font-mono); font-size: 12.5px; }
  .s-foot { margin: 0; padding: 0 16px 12px; font-size: 12.5px; color: var(--muted); }
  .s-foot code { font-family: var(--font-mono); font-size: 12px; white-space: nowrap; }
  .s-alone { padding-top: 12px; }
  .s-failing { margin: 0; padding: 0 16px 12px; font-size: 13px; }
  .ok { color: var(--success); }
  .err { color: var(--danger); }
</style>
