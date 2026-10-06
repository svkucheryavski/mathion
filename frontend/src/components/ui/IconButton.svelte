<script lang="ts">
  // Shared icon-only button. A <button> shell carrying data-glyph, a required
  // title (tooltip + a11y label default) and an inline glyph SVG. Glyph paths
  // are transcribed verbatim from the titled action controls in
  // docs/design/visual-refresh/reference-screens.dc.html. Glyph set:
  // pencil | duplicate | disable | enable | trash | plus | up | down | chevron |
  // chevron-right | close | back | check.
  type Size = 'sm' | 'md';
  type Glyph =
    | 'pencil' | 'duplicate' | 'disable' | 'enable' | 'trash' | 'plus' | 'up' | 'down'
    | 'chevron' | 'chevron-right' | 'close' | 'back' | 'check';
  type Props = {
    glyph: Glyph;
    // Required: the tooltip AND the default screen-reader label. A disabled
    // control keeps its slot and states its reason here.
    title: string;
    size?: Size;
    borderless?: boolean;
    disabled?: boolean;
    danger?: boolean;
    // Slice-5a: `round` = the 28px circular back button (ref 1473); `primary` =
    // the filled create / save control (ref 1479, 1546).
    round?: boolean;
    primary?: boolean;
    onclick?: () => void;
    onmousedown?: (e: MouseEvent) => void;
    // Forward aria-label so an icon-only button can announce a purpose distinct
    // from its tooltip; falls back to `title` when omitted.
    'aria-label'?: string;
    // The rest are forwarded verbatim and omitted from the DOM when undefined.
    'aria-hidden'?: boolean | 'true' | 'false';
    'aria-expanded'?: boolean;
    'aria-controls'?: string;
    id?: string;
    tabindex?: number;
    // Bindable ref to the <button> — InlineField returns focus here.
    element?: HTMLButtonElement;
  };
  let {
    glyph,
    title,
    size = 'md',
    borderless = false,
    disabled = false,
    danger = false,
    round = false,
    primary = false,
    onclick = undefined,
    onmousedown = undefined,
    'aria-label': ariaLabel = undefined,
    'aria-hidden': ariaHidden = undefined,
    'aria-expanded': ariaExpanded = undefined,
    'aria-controls': ariaControls = undefined,
    id = undefined,
    tabindex = undefined,
    element = $bindable(),
  }: Props = $props();
</script>

<button
  bind:this={element}
  type="button"
  class="icon-btn {size}"
  class:danger
  class:borderless
  class:round
  class:primary
  data-glyph={glyph}
  {disabled}
  {title}
  {id}
  {tabindex}
  aria-label={ariaLabel ?? title}
  aria-hidden={ariaHidden}
  aria-expanded={ariaExpanded}
  aria-controls={ariaControls}
  {onclick}
  {onmousedown}
>
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if glyph === 'pencil'}
      <path d="M3.2 12.8l.5-2.7 6.9-6.9 2.2 2.2-6.9 6.9z" /><line x1="9.6" y1="3.8" x2="12.2" y2="6.4" />
    {:else if glyph === 'duplicate'}
      <rect x="5.8" y="5.8" width="7.2" height="7.2" rx="1.4" /><path d="M10.2 3.6H4.4A1.4 1.4 0 0 0 3 5v5.8" />
    {:else if glyph === 'disable'}
      <circle cx="8" cy="8" r="5.4" /><line x1="4.6" y1="11.4" x2="11.4" y2="4.6" />
    {:else if glyph === 'enable'}
      <circle cx="8" cy="8" r="5.4" /><polyline points="5.5,8.2 7.3,10 10.6,5.9" />
    {:else if glyph === 'trash'}
      <line x1="3" y1="4.6" x2="13" y2="4.6" /><path d="M5.5 4.6V3.2h5v1.4" /><path d="M4.4 4.6l.7 8.2h5.8l.7-8.2" />
    {:else if glyph === 'plus'}
      <line x1="8" y1="3.4" x2="8" y2="12.6" /><line x1="3.4" y1="8" x2="12.6" y2="8" />
    {:else if glyph === 'up'}
      <line x1="8" y1="12.4" x2="8" y2="3.6" /><polyline points="4.4,7.2 8,3.6 11.6,7.2" />
    {:else if glyph === 'down'}
      <line x1="8" y1="3.6" x2="8" y2="12.4" /><polyline points="4.4,8.8 8,12.4 11.6,8.8" />
    {:else if glyph === 'chevron'}
      <polyline points="4.6,6.6 8,10 11.4,6.6" />
    {:else if glyph === 'chevron-right'}
      <polyline points="6.6,4.6 10,8 6.6,11.4" />
    {:else if glyph === 'close'}
      <line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" />
    {:else if glyph === 'back'}
      <line x1="12.4" y1="8" x2="3.6" y2="8" /><polyline points="7.2,4.4 3.6,8 7.2,11.6" />
    {:else if glyph === 'check'}
      <!-- per-element 1.9: the check is the one heavier mark (visual-spec §4) -->
      <polyline points="3.4,8.4 6.6,11.6 12.6,4.8" stroke-width="1.9" />
    {/if}
  </svg>
</button>

<style>
  /* Boxed default: fixed square so a row of icon buttons stays aligned even
     when one is disabled. Colour is functional-secondary (--muted), never a
     fill — except `primary`, the filled create / save control. */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    padding: 0;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
  }
  .sm { width: var(--glyph-btn); height: var(--glyph-btn); }
  .md { width: 28px; height: 28px; }
  .sm svg { width: 12px; height: 12px; }
  .md svg { width: 14px; height: 14px; }
  /* Danger (trash): a red glyph, never a red fill. */
  .danger { color: var(--danger); }
  /* Borderless (chevron/fold controls): no chrome, just the muted mark. */
  .borderless {
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .round { border-radius: 50%; /* ref 1473 */ }
  .primary {
    background: var(--primary);
    color: var(--primary-text);
    border-color: var(--primary); /* ref 1479 */
  }
  /* Disabled = a forbidden action that must keep its slot (spec §4). Recede via
     tokens, never opacity — opacity would composite the glyph against the page.
     `.icon-btn:disabled` (0,3,0 with the scope hash) beats `.danger` and
     `.primary` (0,2,0), so a disabled trash or a disabled filled `+` greys out too. */
  .icon-btn:disabled {
    background: var(--bg);
    color: var(--faint);
    border-color: var(--border-faint);
    cursor: not-allowed;
  }
</style>
