// Phone photos are far bigger than a grader needs, so each image is made smaller in the browser before it is sent. It saves
// the student's mobile data and the free storage (TRD §9.1 step 0). The server's limits and checks still apply to what it gets.

export const MAX_EDGE = 2000; // px, the long side
export const JPEG_QUALITY = 0.8;

/** The size that fits the long side within `max`, keeping the shape. An image that already fits keeps its size. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * The image as a JPEG no larger than MAX_EDGE on its long side, or the file itself when it already fits. When the browser
 * cannot do this (it cannot read the image, or it has no canvas), the original is sent: resizing only saves data.
 */
export async function resizeImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); // a phone's rotation is applied
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    if (width === bitmap.width && height === bitmap.height) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = 'white'; // a PNG's see-through pixels would turn black in a JPEG
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}
