// Branding D2, D4-D6: a logo or tab icon being chosen. A chosen file's bytes
// are read once and run through the server's whole check at once
// (pngCheck), so a refused file never previews; the preview then waits for
// img.decode(), and Save waits for it too. While the file is read the pick is
// `checking`, a change that isn't ready, so Save waits then as well. Save
// sends those same bytes.
// Reset to default is a pending change like a chosen file; the last one wins.
// A refusal drops every pending change, so the preview is the saved item.
import { PanelForm } from './formBase.svelte';
import { checkPngBytes, PNG_MAX_BYTES, pngTooBig } from '../pngCheck';
import type { PanelImageSize } from '../superuser';

export const IMAGE_TEXT = {
  logo: {
    title: 'Edit logo',
    hint: "One PNG with your logo and name, at least 56 px tall so it stays sharp, also on the sign-in page. It's scaled to fit and never stretched. Up to 1 MB.",
  },
  icon: {
    title: 'Edit tab icon',
    hint: 'A square PNG, at least 180 px on a side, so it stays sharp in tabs and on phones. Up to 1 MB.',
  },
};

/** The saved upload's size and version, or null for the default. */
export type SavedImage = (PanelImageSize & { version: string }) | null;

export type Chosen = {
  bytes: Uint8Array<ArrayBuffer>; name: string; width: number; height: number;
  advice: string[]; url: string; decoded: boolean;
};

function readBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function dataUrl(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

export class LogoPick extends PanelForm<SavedImage> {
  readonly kind: 'logo' | 'icon';
  pending = $state<{ kind: 'file'; file: Chosen } | { kind: 'reset' } | null>(null);
  /** A chosen file is being read and checked: a change, not yet ready. */
  checking = $state(false);
  // Each choice and each Reset counts; a read or decode answer for an earlier one is ignored.
  private turn = 0;

  constructor(kind: 'logo' | 'icon', saved: SavedImage = null) {
    super(saved);
    this.kind = kind;
  }

  readonly changed = $derived(this.checking || this.pending !== null);
  readonly ready = $derived(
    !this.checking
    && (this.pending?.kind === 'reset' || (this.pending?.kind === 'file' && this.pending.file.decoded)),
  );

  /** What the previews show: a decoded choice, the default after Reset, or the saved item. */
  readonly shown = $derived.by((): { src: string; width: number; height: number } | null => {
    if (this.pending?.kind === 'reset') return null;
    if (this.pending?.kind === 'file' && this.pending.file.decoded) {
      return { src: this.pending.file.url, width: this.pending.file.width, height: this.pending.file.height };
    }
    if (!this.saved) return null;
    return { src: `/api/branding/${this.kind}.png?v=${this.saved.version}`, width: this.saved.width, height: this.saved.height };
  });

  private refuse(sentence: string): void {
    this.pending = null;
    this.error = sentence;
  }

  async choose(file: File): Promise<void> {
    const mine = ++this.turn;
    this.edited();
    // Rev 15: "All files" lets any file be picked; one over the cap is
    // refused before it is read, with the sentence the byte check gives.
    if (file.size > PNG_MAX_BYTES) { this.checking = false; this.refuse(pngTooBig(this.kind)); return; }
    this.checking = true;
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await readBytes(file);
    } catch {
      if (mine === this.turn) { this.checking = false; this.refuse("This file can't be read."); }
      return;
    }
    if (mine !== this.turn) return;
    this.checking = false;
    const checked = checkPngBytes(bytes, this.kind);
    if ('refused' in checked) { this.refuse(checked.refused); return; }
    const chosen: Chosen = { bytes, name: file.name, width: checked.width, height: checked.height,
      advice: checked.advice, url: dataUrl(bytes), decoded: false };
    this.pending = { kind: 'file', file: chosen };
    // D5: a partly corrupt PNG passes the check and can still fire load; decode is the test.
    const img = new Image();
    img.src = chosen.url;
    img.decode().then(
      () => { if (mine === this.turn && this.pending?.kind === 'file') this.pending.file.decoded = true; },
      () => { if (mine === this.turn) this.refuse("This PNG can't be shown by a browser."); },
    );
  }

  reset(): void {
    this.turn++;
    this.edited();
    this.checking = false;
    this.pending = { kind: 'reset' };
  }
}
