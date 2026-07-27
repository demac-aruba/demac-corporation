const fs = require('fs');

const contractsFile = 'src/features/technicianPortal/contracts.ts';
let contracts = fs.readFileSync(contractsFile, 'utf8');
if (!contracts.includes('customerReportNote?: string;')) {
  const anchor = '  resultCode?: string;\n  resultNotes?: string;';
  if (!contracts.includes(anchor)) throw new Error('WorkIntervention result fields were not found.');
  contracts = contracts.replace(anchor, `${anchor}\n  customerReportNote?: string;\n  reviewedAt?: string;`);
  fs.writeFileSync(contractsFile, contracts);
}

const pdfFile = 'src/services/technicalReportPdf.ts';
let pdfSource = fs.readFileSync(pdfFile, 'utf8');
if (!pdfSource.includes('function reportImageProxyUrl(')) {
  const oldFunction = `async function imageUrlToJpeg(url: string): Promise<PdfImage | undefined> {
  if (typeof document === 'undefined') return undefined;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = document.createElement('img');
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('No se pudo leer una fotografía del reporte.'));
        element.src = objectUrl;
      });
      const maxDimension = 2400;
      const ratio = Math.min(maxDimension / image.naturalWidth, maxDimension / image.naturalHeight, 1);
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const jpegBlob = await new Promise<Blob | undefined>((resolve) => canvas.toBlob((result) => resolve(result ?? undefined), 'image/jpeg', 0.88));
      if (!jpegBlob) return undefined;
      return {
        key: url,
        bytes: new Uint8Array(await jpegBlob.arrayBuffer()),
        width,
        height,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.warn('No se pudo incorporar una fotografía al PDF:', error);
    return undefined;
  }
}`;

  const newFunction = `function reportImageProxyUrl(originalUrl: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://demac-aruba.com';
  return \`${'${origin}'}/api/report-image?sourceUrl=${'${encodeURIComponent(originalUrl)}'}\`;
}

async function imageUrlToJpeg(url: string): Promise<PdfImage | undefined> {
  if (typeof document === 'undefined') return undefined;
  try {
    const response = await fetch(reportImageProxyUrl(url));
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(\`No se pudo preparar la fotografía para el PDF (${ '${response.status}' })${ '${details ? `: ${details}` : \'\'}' }\`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('El servidor devolvió una fotografía vacía.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = document.createElement('img');
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('No se pudo leer la fotografía normalizada del reporte.'));
        element.src = objectUrl;
      });
      return {
        key: url,
        bytes,
        width: Math.max(1, image.naturalWidth),
        height: Math.max(1, image.naturalHeight),
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.warn('No se pudo incorporar una fotografía al PDF:', error);
    return undefined;
  }
}`;

  if (!pdfSource.includes(oldFunction)) throw new Error('The original PDF image loader was not found.');
  pdfSource = pdfSource.replace(oldFunction, newFunction);
  fs.writeFileSync(pdfFile, pdfSource);
}

console.log('Customer report experience patch applied.');
