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
}

if (!pdfSource.includes('const PHOTO_GRID_PAGE_SIZE = 4;')) {
  const originalStartMarker = '    for (const field of section.fields) {';
  const previousLayoutStartMarker = '    const PHOTO_COLUMN_GAP = 10;';
  const endMarker = '    cursor += 8;\n  }\n\n  if (report.observation) {';
  const start = pdfSource.includes(previousLayoutStartMarker)
    ? pdfSource.indexOf(previousLayoutStartMarker)
    : pdfSource.indexOf(originalStartMarker);
  const end = pdfSource.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('The PDF field layout block was not found.');

  const replacement = `    const PHOTO_GRID_PAGE_SIZE = 4;
    const PHOTO_COLUMN_GAP = 10;
    const PHOTO_ROW_GAP = 10;
    const PHOTO_CARD_WIDTH = (CONTENT_WIDTH - PHOTO_COLUMN_GAP) / 2;
    const PHOTO_MAX_IMAGE_HEIGHT = 205;
    let fieldIndex = 0;
    while (fieldIndex < section.fields.length) {
      const field = section.fields[fieldIndex];
      if (!field.photoUrl) {
        const value = field.value || 'Sin información';
        const valueLines = wrapText(value, CONTENT_WIDTH - 18, 9);
        const height = 31 + valueLines.length * 12;
        ensureSpace(height + 8);
        fillRect(page, MARGIN, cursor, CONTENT_WIDTH, height, WHITE, BORDER);
        drawText(page, field.label.toUpperCase(), MARGIN + 9, cursor + 8, 6.8, { bold: true, fill: MUTED });
        valueLines.forEach((entry, index) => drawText(page, entry, MARGIN + 9, cursor + 22 + index * 12, 9, { fill: TEXT }));
        cursor += height + 8;
        fieldIndex += 1;
        continue;
      }

      let photoRunEnd = fieldIndex;
      while (photoRunEnd < section.fields.length && section.fields[photoRunEnd].photoUrl) photoRunEnd += 1;
      let photoChunkStart = fieldIndex;
      let firstPhotoChunk = true;

      while (photoChunkStart < photoRunEnd) {
        const photoGroup = section.fields.slice(photoChunkStart, Math.min(photoChunkStart + PHOTO_GRID_PAGE_SIZE, photoRunEnd));
        const prepared = photoGroup.map((photoField) => {
          const image = photoField.photoUrl ? images.get(photoField.photoUrl) : undefined;
          const titleLines = wrapText(photoField.label, PHOTO_CARD_WIDTH - 18, 9.2).slice(0, 3);
          const titleHeight = titleLines.length * 11.5;
          const caption = photoField.photoCaption && photoField.photoCaption !== photoField.label ? photoField.photoCaption : '';
          const captionLines = caption ? wrapText(caption, PHOTO_CARD_WIDTH - 18, 7.5).slice(0, 2) : [];
          const captionHeight = captionLines.length * 9.5;
          if (!image) {
            return {
              photoField,
              image,
              titleLines,
              titleHeight,
              captionLines,
              captionHeight,
              imageWidth: PHOTO_CARD_WIDTH - 18,
              imageHeight: 34,
              cardHeight: 18 + titleHeight + 7 + 34 + captionHeight + 15,
            };
          }
          const availableWidth = PHOTO_CARD_WIDTH - 18;
          const scale = Math.min(availableWidth / image.width, PHOTO_MAX_IMAGE_HEIGHT / image.height, 1);
          const imageWidth = image.width * scale;
          const imageHeight = image.height * scale;
          return {
            photoField,
            image,
            titleLines,
            titleHeight,
            captionLines,
            captionHeight,
            imageWidth,
            imageHeight,
            cardHeight: 18 + titleHeight + 7 + imageHeight + captionHeight + 15,
          };
        });

        const rows = [prepared.slice(0, 2), prepared.slice(2, 4)].filter((row) => row.length);
        const rowHeights = rows.map((row) => Math.max(...row.map((item) => item.cardHeight)));
        const blockHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows.length - 1) * PHOTO_ROW_GAP;

        if (!firstPhotoChunk || cursor + blockHeight > FOOTER_TOP - 18) {
          addPage();
          drawText(page, section.title + ' - continuación', MARGIN, cursor, 12, { bold: true, fill: DARK_BLUE });
          cursor += 22;
        }

        rows.forEach((row, rowIndex) => {
          const rowHeight = rowHeights[rowIndex];
          row.forEach((item, columnIndex) => {
            const x = MARGIN + columnIndex * (PHOTO_CARD_WIDTH + PHOTO_COLUMN_GAP);
            fillRect(page, x, cursor, PHOTO_CARD_WIDTH, rowHeight, WHITE, BORDER);
            let itemTop = cursor + 9;
            item.titleLines.forEach((entry, lineIndex) => drawText(page, entry, x + 9, itemTop + lineIndex * 11.5, 9.2, { bold: true, fill: BLUE }));
            itemTop += item.titleHeight + 7;
            if (!item.image) {
              fillRect(page, x + 9, itemTop, PHOTO_CARD_WIDTH - 18, 34, LIGHT_GRAY, BORDER);
              drawText(page, 'Fotografía no disponible para el PDF.', x + 17, itemTop + 11, 7.5, { fill: MUTED });
              itemTop += 41;
            } else {
              page.imageKeys.add(item.image.key);
              const imageX = x + (PHOTO_CARD_WIDTH - item.imageWidth) / 2;
              page.commands.push('q ' + number(item.imageWidth) + ' 0 0 ' + number(item.imageHeight) + ' ' + number(imageX) + ' ' + number(topToY(itemTop, item.imageHeight)) + ' cm /' + item.image.resourceName + ' Do Q');
              itemTop += item.imageHeight + 7;
            }
            item.captionLines.forEach((entry, lineIndex) => drawText(page, entry, x + 9, itemTop + lineIndex * 9.5, 7.5, { bold: true, fill: TEXT }));
          });
          cursor += rowHeight + (rowIndex < rows.length - 1 ? PHOTO_ROW_GAP : 0);
        });

        cursor += 12;
        photoChunkStart += photoGroup.length;
        firstPhotoChunk = false;
      }

      fieldIndex = photoRunEnd;
    }
`;

  pdfSource = pdfSource.slice(0, start) + replacement + pdfSource.slice(end);
}

fs.writeFileSync(pdfFile, pdfSource);
console.log('Customer report experience patch applied.');
