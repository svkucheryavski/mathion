<script lang="ts">
  // A two-state switch (Slice-6b R16). A native <button type="button"> with
  // role="switch": Space and Enter come from the platform, and it never
  // submits a form or becomes one's default button. The caller writes the
  // visible <label for={id}>; a click on that label clicks the button.
  let {
    checked = $bindable(false),
    id,
    disabled = false,
    frozen = false,
    title = undefined,
    describedby = undefined,
    onchange = undefined,
  }: {
    checked?: boolean;
    id: string;
    disabled?: boolean;
    // R19: a request is running. The switch keeps focus and its look, and
    // ignores clicks.
    frozen?: boolean;
    title?: string;
    describedby?: string;
    // Slice-6c R42: the new value, after the flip (the Overview saves it).
    onchange?: (next: boolean) => void;
  } = $props();

  function toggle() {
    if (disabled || frozen) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  {id}
  type="button"
  role="switch"
  class="switch"
  class:on={checked}
  aria-checked={checked}
  aria-disabled={frozen ? 'true' : undefined}
  aria-describedby={describedby}
  {disabled}
  {title}
  onclick={toggle}
><span class="knob" aria-hidden="true"></span></button>

<style>
  /* 10k: a 30×17 track with a 13px knob. Focus shows the global ring (base.css). */
  .switch {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    width: 30px;
    height: 17px;
    padding: 2px;
    border: 0;
    border-radius: 9px;
    background: var(--border-strong);
    cursor: pointer;
  }
  .switch.on {
    background: var(--primary);
  }
  .switch:disabled {
    background: var(--border-faint);
    cursor: not-allowed;
  }
  .knob {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--surface);
    transition: transform .12s;
  }
  .switch.on .knob {
    transform: translateX(13px);
  }
</style>
