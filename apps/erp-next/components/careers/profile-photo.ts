import { fileError, type ProfilePhoto } from '../../lib/careers-preview';
/** Browser-only review. This does not claim server scanning or production storage. */
export async function prepareProfilePhoto(file: File): Promise<ProfilePhoto> {
  const issue = fileError(file, 'photo');
  if (issue) throw new Error(issue);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const source = URL.createObjectURL(file);
    let finished = false;
    const finish = (error?: Error, result?: ProfilePhoto) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(source);
      if (error) reject(error); else if (result) resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('The photo took too long to open. Try a smaller JPG or PNG. Your answers are still here.')), 15000);
    image.onerror = () => finish(new Error('This browser could not open that photo. Choose JPG or PNG, or take a new photo. Your answers are still here.'));
    image.onload = () => {
      try {
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32000000) throw new Error('Choose a photo with no more than 32 megapixels.');
        const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo preview is unavailable. Try another browser without closing this form.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', .86);
        finish(undefined, { dataUrl, name: 'profile-photo.jpg', size: Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * .75) });
      } catch (error) { finish(error instanceof Error ? error : new Error('Unable to prepare this photo.')); }
    };
    image.src = source;
  });
}
