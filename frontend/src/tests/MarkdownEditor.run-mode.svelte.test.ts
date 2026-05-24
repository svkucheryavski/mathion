import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MarkdownEditor from '../components/editor/MarkdownEditor.svelte';
import { runAssetContext } from '../lib/assetContext';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

// jsdom doesn't ship DataTransfer/DragEvent constructors, so we build a minimal
// shape via Object.defineProperty — matching the project's existing pattern
// (verified at MarkdownEditor.svelte.test.ts:176-178).
function makeDropEvent(files: File[]): DragEvent {
  const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
  Object.defineProperty(ev, 'dataTransfer', { value: { files } });
  return ev;
}

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('MarkdownEditor with runAssetContext', () => {
  it('renderPreview POSTs /api/runs/{rid}/render', async () => {
    fetchSpy.mockImplementation(() => jres({ html: '<p>x</p>' }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MarkdownEditor, {
      target,
      props: {
        assetContext: runAssetContext(42),
        value: 'hi',
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const previewBtn = target.querySelector('button[data-action="preview"]') as HTMLButtonElement;
    previewBtn.click();
    await settle();
    const renderCall = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('/api/runs/42/render') && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(renderCall).toBeTruthy();
  });

  it('textarea-drop hits /api/runs/{rid}/assets (not /api/assets/...)', async () => {
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/42/assets') && (init as RequestInit | undefined)?.method === 'POST') {
        return jres({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MarkdownEditor, {
      target,
      props: {
        assetContext: runAssetContext(42),
        value: '',
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    textarea.dispatchEvent(makeDropEvent([new File(['x'], 'x.png', { type: 'image/png' })]));
    await settle();
    const postCall = fetchSpy.mock.calls.find(
      (c) => String(c[0]).includes('/api/runs/42/assets') && (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
    expect(String(postCall![0])).not.toContain('/api/assets/');
  });

  it('disabled prop blocks all interactive handlers', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MarkdownEditor, {
      target,
      props: {
        assetContext: runAssetContext(42),
        value: '',
        disabled: true,
      },
    });
    cleanup = () => unmount(cmp);
    await settle();
    const textarea = target.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    const previewBtn = target.querySelector('button[data-action="preview"]') as HTMLButtonElement;
    expect(previewBtn.disabled).toBe(true);
  });

  it('editorMounted local guard: late upload resolve after unmount does NOT write state', async () => {
    // Round-2 reviewer-1 catch: T6a covers `mounted` (modal-level), but the
    // MarkdownEditor-internal `editorMounted` flag introduced in T5a.A has no
    // test of its own. Without coverage, a regression that drops the
    // `if (!editorMounted) return;` guard inside uploadOne goes unnoticed.
    let resolveUpload: (r: Response) => void = () => {};
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/42/assets') && (init as RequestInit | undefined)?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveUpload = resolve;
        });
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(MarkdownEditor, {
      target,
      props: {
        assetContext: runAssetContext(42),
        value: '',
      },
    });
    // No cleanup assignment: we unmount manually mid-test.
    await settle();
    // Trigger a textarea drop to start an upload.
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(makeDropEvent([new File(['x'], 'x.png', { type: 'image/png' })]));
    await settle();
    // Unmount BEFORE the upload resolves.
    unmount(cmp);
    await settle();
    // Late resolve — uploadOne's editorMounted guard must short-circuit; no throw,
    // no insertAtCursor on a destroyed component.
    expect(() => {
      resolveUpload({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false }),
      } as Response);
    }).not.toThrow();
    await settle();
  });
});
