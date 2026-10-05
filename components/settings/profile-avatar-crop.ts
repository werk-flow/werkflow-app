import { type Area } from 'react-easy-crop';

const OUTPUT_AVATAR_SIZE = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Das Bild konnte nicht geladen werden.'));
    image.src = src;
  });
}

export async function createCroppedAvatarBlob(imageSrc: string, cropAreaPixels: Area): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_AVATAR_SIZE;
  canvas.height = OUTPUT_AVATAR_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Die Bildverarbeitung konnte nicht initialisiert werden.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    cropAreaPixels.x,
    cropAreaPixels.y,
    cropAreaPixels.width,
    cropAreaPixels.height,
    0,
    0,
    OUTPUT_AVATAR_SIZE,
    OUTPUT_AVATAR_SIZE,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Das Bild konnte nicht exportiert werden.'));
          return;
        }

        resolve(blob);
      },
      'image/jpeg',
      0.92,
    );
  });
}
