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

  it('editorMounted guard: late upload resolve after unmount does NOT bump bound refreshKey', async () => {
    // Codex round-1 catch: a no-throw-on-late-resolve assertion alone doesn't
    // prove the guard. `insertAtCursor()` already no-ops when textareaEl is
    // null after unmount, so even with the guard removed the test could pass.
    //
    // Real observable: `handleTextareaDrop` runs `refreshKey++` AFTER
    // uploadOne returns (MarkdownEditor.svelte:189). The guard at
    // MarkdownEditor.svelte:117 makes uploadOne return null when the
    // component is unmounted, which makes the drop loop `break` BEFORE
    // refreshKey++ runs. Binding refreshKey and asserting it stays 0 is the
    // direct test of the guard: with guard present → 0; with guard removed →
    // uploadOne returns the item → refreshKey++ → 1.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      assetContext: runAssetContext(42),
      value: '',
      refreshKey: 0,
    });
    const cmp = mount(MarkdownEditor, { target, props: propsRef });
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(makeDropEvent([new File(['x'], 'x.png', { type: 'image/png' })]));
    await settle();
    expect(propsRef.refreshKey).toBe(0); // upload not yet resolved
    unmount(cmp);
    await settle();
    expect(() => {
      resolveUpload({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ id: 1, filename: 'x.png', mime_type: 'image/png', file_size: 1, is_referenced: false }),
      } as Response);
    }).not.toThrow();
    await settle();
    // Guard short-circuited uploadOne → drop loop broke → refreshKey never
    // incremented. Without the guard this would be 1.
    expect(propsRef.refreshKey).toBe(0);
  });

  it('uploadOne AbortError → null: silently breaks drop loop without setting uploadError', async () => {
    // Opus round-1 catch: the AbortError → null branch at
    // MarkdownEditor.svelte:122-123 was uncovered. Wire-layer AbortError
    // preservation is tested in lib/assets.test.ts:126 and
    // lib/runAssets.test.ts:70, but the component-level "catch AbortError,
    // return null, don't set uploadError" semantic had no test.
    fetchSpy.mockImplementation((url, init) => {
      if (String(url).includes('/api/runs/42/assets') && (init as RequestInit | undefined)?.method === 'POST') {
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      }
      return jres([]);
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      assetContext: runAssetContext(42),
      value: '',
      uploadError: null,
      refreshKey: 0,
    });
    const cmp = mount(MarkdownEditor, { target, props: propsRef });
    cleanup = () => unmount(cmp);
    await settle();
    const ta = target.querySelector('textarea') as HTMLTextAreaElement;
    ta.dispatchEvent(makeDropEvent([
      new File(['x'], 'x.png', { type: 'image/png' }),
      new File(['y'], 'y.png', { type: 'image/png' }),
    ]));
    await settle();
    // AbortError must NOT surface as uploadError (silent user-cancel contract).
    expect(propsRef.uploadError).toBeNull();
    // Drop loop must break on null → refreshKey never incremented.
    expect(propsRef.refreshKey).toBe(0);
    // Only the first file's upload should have been attempted (POST count).
    const posts = fetchSpy.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(posts.length).toBe(1);
  });
});
