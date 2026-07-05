import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractImageFiles, handleImageFiles } from '../../src/editor/ImagePasteHandler.js';

function fakeDataTransfer(files: File[]): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: undefined as unknown as DataTransferItemList,
  } as unknown as DataTransfer;
}

describe('extractImageFiles', () => {
  it('returns only image-typed files from dataTransfer.files', () => {
    const image = new File(['x'], 'pic.png', { type: 'image/png' });
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' });
    const result = extractImageFiles(fakeDataTransfer([image, text]));
    expect(result).toEqual([image]);
  });

  it('returns an empty array for null/undefined dataTransfer', () => {
    expect(extractImageFiles(null)).toEqual([]);
    expect(extractImageFiles(undefined)).toEqual([]);
  });

  it('falls back to dataTransfer.items when .files is empty (clipboard paste shape)', () => {
    const image = new File(['x'], 'pasted.png', { type: 'image/png' });
    const items = [
      { kind: 'file', type: 'image/png', getAsFile: () => image },
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ];
    const dt = {
      files: [] as unknown as FileList,
      items: items as unknown as DataTransferItemList,
    } as unknown as DataTransfer;
    expect(extractImageFiles(dt)).toEqual([image]);
  });
});

describe('handleImageFiles (mocked fetch)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uploads each image file and reports back the correct markdown insertion', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ href: '../assets/doc-a/167.png' }),
    });

    const image = new File(['x'], 'pic.png', { type: 'image/png' });
    const received: string[] = [];

    await handleImageFiles([image], {
      repoId: 'repo-a',
      docId: 'doc-a',
      onImageReady: (markdown) => received.push(markdown),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/repos/repo-a/docs/doc-a/assets');
    expect(init.method).toBe('POST');
    expect(received).toEqual(['![](../assets/doc-a/167.png)']);
  });

  it('uploads multiple images in order', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    let call = 0;
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ href: `assets/doc-a/${++call}.png` }),
    }));

    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ];
    const received: string[] = [];
    await handleImageFiles(files, { repoId: 'repo-a', docId: 'doc-a', onImageReady: (m) => received.push(m) });

    expect(received).toEqual(['![](assets/doc-a/1.png)', '![](assets/doc-a/2.png)']);
  });
});
