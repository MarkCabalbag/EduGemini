// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitWithin, JPEG_QUALITY, MAX_EDGE, resizeImage } from './resize-image';

describe('fitWithin', () => {
  it('shrinks the long side to the limit and keeps the shape', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(4001, 3001, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it('leaves an image that already fits alone, and never makes one bigger', () => {
    expect(fitWithin(2000, 1000, 2000)).toEqual({ width: 2000, height: 1000 });
    expect(fitWithin(640, 480, 2000)).toEqual({ width: 640, height: 480 });
  });
});

// The browser's decoder and canvas are outside the app, so they are replaced. These tests pin what the app asks of them;
// that a real browser agrees is checked in one.
describe('resizeImage', () => {
  const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', { type: 'image/jpeg' });
  const drawn: { size: [number, number]; quality?: number; type?: string }[] = [];
  const close = vi.fn();
  let context: object | null;

  const decodes = (width: number, height: number) =>
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width, height, close })),
    );

  beforeEach(() => {
    drawn.length = 0;
    close.mockClear();
    context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type, quality) {
      drawn.push({ size: [this.width, this.height], type, quality });
      callback(new Blob(['small'], { type }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('makes a big photo a JPEG with its long side at 2000 px', async () => {
    decodes(4000, 3000);
    const result = await resizeImage(photo);

    expect(result).not.toBe(photo);
    expect(result.type).toBe('image/jpeg');
    expect(drawn).toEqual([{ size: [MAX_EDGE, 1500], type: 'image/jpeg', quality: JPEG_QUALITY }]);
    expect(close).toHaveBeenCalled();
  });

  it('applies the rotation the phone recorded', async () => {
    decodes(4000, 3000);
    await resizeImage(photo);
    expect(createImageBitmap).toHaveBeenCalledWith(photo, { imageOrientation: 'from-image' });
  });

  it('sends a small image as it is, without drawing it again', async () => {
    decodes(1200, 900);
    expect(await resizeImage(photo)).toBe(photo);
    expect(drawn).toHaveLength(0);
    expect(close).toHaveBeenCalled();
  });

  it('sends the original when the browser cannot read the image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('cannot decode'))),
    );
    expect(await resizeImage(photo)).toBe(photo);
  });

  it('sends the original when there is no canvas to draw on, or no JPEG comes out', async () => {
    decodes(4000, 3000);
    context = null;
    expect(await resizeImage(photo)).toBe(photo);

    context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));
    expect(await resizeImage(photo)).toBe(photo);
  });
});
