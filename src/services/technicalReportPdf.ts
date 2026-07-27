import { PrintableTechnicalReport } from './reportPrint';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_TOP = PAGE_HEIGHT - 32;

const BLUE: Rgb = [0.03, 0.33, 0.72];
const DARK_BLUE: Rgb = [0.02, 0.20, 0.46];
const TEXT: Rgb = [0.08, 0.12, 0.17];
const MUTED: Rgb = [0.38, 0.43, 0.49];
const BORDER: Rgb = [0.84, 0.87, 0.90];
const LIGHT_BLUE: Rgb = [0.94, 0.97, 1];
const LIGHT_GRAY: Rgb = [0.97, 0.98, 0.99];
const WHITE: Rgb = [1, 1, 1];

type Rgb = [number, number, number];

type PdfImage = {
  key: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  objectNumber?: number;
  resourceName?: string;
};

type PdfPage = {
  commands: string[];
  imageKeys: Set<string>;
};

function number(value: number) {
  return Number(value.toFixed(3)).toString();
}

function color(rgb: Rgb) {
  return `${number(rgb[0])} ${number(rgb[1])} ${number(rgb[2])}`;
}

function winAnsiByte(character: string) {
  const code = character.charCodeAt(0);
  if (code <= 255) return code;
  const replacements: Record<number, number> = {
    0x2018: 0x91,
    0x2019: 0x92,
    0x201c: 0x93,
    0x201d: 0x94,
    0x2022: 0x95,
    0x2013: 0x96,
    0x2014: 0x97,
    0x2026: 0x85,
  };
  return replacements[code] ?? 0x3f;
}

function pdfString(value: string | number) {
  const bytes = Array.from(String(value ?? ''), winAnsiByte);
  let output = '(';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) output += `\\${String.fromCharCode(byte)}`;
    else if (byte >= 0x20 && byte <= 0x7e) output += String.fromCharCode(byte);
    else output += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return `${output})`;
}

function approximateTextWidth(value: string, size: number) {
  return Array.from(value).reduce((width, character) => width + (character === ' ' ? size * 0.27 : size * 0.52), 0);
}

function wrapText(value: string, maxWidth: number, fontSize: number) {
  const paragraphs = String(value || '').replace(/\r/g, '').split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || approximateTextWidth(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = word;
      while (approximateTextWidth(line, fontSize) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && approximateTextWidth(`${line.slice(0, cut)}-`, fontSize) > maxWidth) cut -= 1;
        lines.push(`${line.slice(0, cut)}-`);
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function asciiBytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function safeFilename(value: string) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'reporte-tecnico-demac';
}

async function imageUrlToJpeg(url: string): Promise<PdfImage | undefined> {
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
}

function createPage() {
  return { commands: [] as string[], imageKeys: new Set<string>() };
}

function topToY(top: number, height = 0) {
  return PAGE_HEIGHT - top - height;
}

function fillRect(page: PdfPage, x: number, top: number, width: number, height: number, fill: Rgb, stroke?: Rgb) {
  page.commands.push(`${color(fill)} rg`);
  if (stroke) {
    page.commands.push(`${color(stroke)} RG 0.7 w`);
    page.commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re B`);
  } else {
    page.commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re f`);
  }
}

function line(page: PdfPage, x1: number, top1: number, x2: number, top2: number, stroke: Rgb, width = 1) {
  page.commands.push(`${color(stroke)} RG ${number(width)} w`);
  page.commands.push(`${number(x1)} ${number(topToY(top1))} m ${number(x2)} ${number(topToY(top2))} l S`);
}

function drawText(page: PdfPage, value: string | number, x: number, top: number, size: number, options?: { bold?: boolean; fill?: Rgb }) {
  page.commands.push(`${color(options?.fill ?? TEXT)} rg`);
  page.commands.push(`BT /${options?.bold ? 'F2' : 'F1'} ${number(size)} Tf ${number(x)} ${number(topToY(top, size))} Td ${pdfString(value)} Tj ET`);
}

function drawWrappedText(page: PdfPage, value: string, x: number, top: number, width: number, size: number, options?: { bold?: boolean; fill?: Rgb; lineHeight?: number }) {
  const lineHeight = options?.lineHeight ?? size * 1.38;
  const lines = wrapText(value, width, size);
  lines.forEach((entry, index) => drawText(page, entry, x, top + index * lineHeight, size, options));
  return lines.length * lineHeight;
}

function buildPages(report: PrintableTechnicalReport, images: Map<string, PdfImage>) {
  const pages: PdfPage[] = [];
  let page = createPage();
  let cursor = 34;

  function addPage() {
    page = createPage();
    pages.push(page);
    cursor = 34;
    drawText(page, 'DEMAC', MARGIN, cursor, 18, { bold: true, fill: DARK_BLUE });
    drawText(page, 'PROFESSIONAL COOLING SOLUTIONS', MARGIN + 76, cursor + 4, 8, { bold: true, fill: BLUE });
    cursor += 28;
    line(page, MARGIN, cursor, PAGE_WIDTH - MARGIN, cursor, BLUE, 2);
    cursor += 16;
  }

  function ensureSpace(height: number) {
    if (cursor + height <= FOOTER_TOP - 18) return;
    addPage();
  }

  function drawSummaryItem(label: string, value: string, x: number, top: number, width: number) {
    fillRect(page, x, top, width, 47, LIGHT_GRAY, BORDER);
    drawText(page, label.toUpperCase(), x + 8, top + 8, 6.8, { bold: true, fill: MUTED });
    drawWrappedText(page, value, x + 8, top + 21, width - 16, 8.5, { bold: true, lineHeight: 10.2 });
  }

  addPage();
  drawText(page, report.reportTitle, MARGIN, cursor, 21, { bold: true });
  cursor += 27;
  drawText(page, report.reportCode, MARGIN, cursor, 9, { bold: true, fill: BLUE });
  cursor += 20;

  const summary = [
    ['Cliente', report.clientName],
    ['Propiedad', report.propertyName],
    ['Dirección', report.address],
    ['Orden', report.orderId],
    ['Aire acondicionado', `${report.equipmentName} · ${report.equipmentDetails}`],
    ['Trabajo', report.workType],
    ['Fecha del reporte', report.reportDate],
  ];
  const gap = 8;
  const columnWidth = (CONTENT_WIDTH - gap) / 2;
  summary.forEach(([label, value], index) => {
    const column = index % 2;
    if (column === 0 && index > 0) cursor += 55;
    drawSummaryItem(label, value, MARGIN + column * (columnWidth + gap), cursor, columnWidth);
  });
  cursor += 65;

  for (const section of report.sections) {
    ensureSpace(54);
    line(page, MARGIN, cursor, PAGE_WIDTH - MARGIN, cursor, BLUE, 1.5);
    cursor += 10;
    drawText(page, section.title, MARGIN, cursor, 14, { bold: true, fill: DARK_BLUE });
    drawText(page, section.status, PAGE_WIDTH - MARGIN - 75, cursor + 1, 8, { bold: true, fill: BLUE });
    cursor += 24;

    for (const field of section.fields) {
      if (field.photoUrl) {
        const image = images.get(field.photoUrl);
        const titleHeight = drawWrappedText(page, field.label, MARGIN, cursor, CONTENT_WIDTH, 10.5, { bold: true, fill: BLUE, lineHeight: 13 });
        cursor += titleHeight + 7;
        if (!image) {
          ensureSpace(36);
          fillRect(page, MARGIN, cursor, CONTENT_WIDTH, 30, LIGHT_GRAY, BORDER);
          drawText(page, 'Fotografía no disponible para el PDF.', MARGIN + 10, cursor + 10, 8.5, { fill: MUTED });
          cursor += 40;
          continue;
        }
        const maxWidth = CONTENT_WIDTH;
        const maxHeight = 390;
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        ensureSpace(height + 28);
        page.imageKeys.add(image.key);
        const x = MARGIN + (CONTENT_WIDTH - width) / 2;
        page.commands.push(`q ${number(width)} 0 0 ${number(height)} ${number(x)} ${number(topToY(cursor, height))} cm /${image.resourceName} Do Q`);
        cursor += height + 8;
        if (field.photoCaption && field.photoCaption !== field.label) {
          cursor += drawWrappedText(page, field.photoCaption, MARGIN, cursor, CONTENT_WIDTH, 8, { bold: true, fill: TEXT, lineHeight: 10 });
        }
        cursor += 14;
        continue;
      }

      const value = field.value || 'Sin información';
      const valueLines = wrapText(value, CONTENT_WIDTH - 18, 9);
      const height = 31 + valueLines.length * 12;
      ensureSpace(height + 8);
      fillRect(page, MARGIN, cursor, CONTENT_WIDTH, height, WHITE, BORDER);
      drawText(page, field.label.toUpperCase(), MARGIN + 9, cursor + 8, 6.8, { bold: true, fill: MUTED });
      valueLines.forEach((entry, index) => drawText(page, entry, MARGIN + 9, cursor + 22 + index * 12, 9, { fill: TEXT }));
      cursor += height + 8;
    }
    cursor += 8;
  }

  if (report.observation) {
    const lines = wrapText(report.observation, CONTENT_WIDTH - 20, 9);
    const height = 42 + lines.length * 12;
    ensureSpace(height + 10);
    fillRect(page, MARGIN, cursor, CONTENT_WIDTH, height, LIGHT_BLUE, BLUE);
    drawText(page, 'OBSERVACIONES', MARGIN + 10, cursor + 10, 9, { bold: true, fill: DARK_BLUE });
    lines.forEach((entry, index) => drawText(page, entry, MARGIN + 10, cursor + 27 + index * 12, 9, { fill: TEXT }));
    cursor += height + 10;
  }

  pages.forEach((item, index) => {
    line(item, MARGIN, PAGE_HEIGHT - 39, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 39, BORDER, 0.6);
    drawText(item, 'Reporte técnico generado por DEMAC Professional Cooling Solutions', MARGIN, PAGE_HEIGHT - 31, 7, { fill: MUTED });
    drawText(item, `Página ${index + 1} de ${pages.length}`, PAGE_WIDTH - MARGIN - 70, PAGE_HEIGHT - 31, 7, { fill: MUTED });
  });

  return pages;
}

function buildPdf(pages: PdfPage[], images: PdfImage[]) {
  const objects: Uint8Array[] = [];
  const pageObjectNumbers = pages.map((_, index) => 5 + index * 2);
  const firstImageObject = 5 + pages.length * 2;
  images.forEach((image, index) => {
    image.objectNumber = firstImageObject + index;
    image.resourceName = `Im${index + 1}`;
  });

  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = asciiBytes(`<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  objects[3] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects[4] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((page, index) => {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    const xObjects = images
      .filter((image) => page.imageKeys.has(image.key))
      .map((image) => `/${image.resourceName} ${image.objectNumber} 0 R`)
      .join(' ');
    objects[pageObject] = asciiBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(PAGE_WIDTH)} ${number(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xObjects ? ` /XObject << ${xObjects} >>` : ''} >> /Contents ${contentObject} 0 R >>`);
    const stream = asciiBytes(page.commands.join('\n'));
    objects[contentObject] = concatBytes([asciiBytes(`<< /Length ${stream.length} >>\nstream\n`), stream, asciiBytes('\nendstream')]);
  });

  images.forEach((image) => {
    objects[image.objectNumber!] = concatBytes([
      asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      asciiBytes('\nendstream'),
    ]);
  });

  const header = asciiBytes('%PDF-1.4\n%DEMAC\n');
  const chunks: Uint8Array[] = [header];
  const offsets: number[] = [0];
  let offset = header.length;
  for (let index = 1; index < objects.length; index += 1) {
    const object = objects[index];
    if (!object) continue;
    offsets[index] = offset;
    const prefix = asciiBytes(`${index} 0 obj\n`);
    const suffix = asciiBytes('\nendobj\n');
    chunks.push(prefix, object, suffix);
    offset += prefix.length + object.length + suffix.length;
  }

  const xrefOffset = offset;
  const xrefLines = [`xref`, `0 ${objects.length}`, '0000000000 65535 f '];
  for (let index = 1; index < objects.length; index += 1) {
    xrefLines.push(`${String(offsets[index] ?? 0).padStart(10, '0')} 00000 n `);
  }
  const trailer = asciiBytes(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  chunks.push(trailer);
  return concatBytes(chunks);
}

export async function createTechnicalReportPdf(report: PrintableTechnicalReport) {
  const photoUrls = [...new Set(report.sections.flatMap((section) => section.fields.map((field) => field.photoUrl).filter((value): value is string => Boolean(value))))];
  const loaded = await Promise.all(photoUrls.map((url) => imageUrlToJpeg(url)));
  const images = loaded.filter((image): image is PdfImage => Boolean(image));
  images.forEach((image, index) => { image.resourceName = `Im${index + 1}`; });
  const imageMap = new Map(images.map((image) => [image.key, image]));
  const pages = buildPages(report, imageMap);
  const bytes = buildPdf(pages, images);
  const filename = `${safeFilename(report.reportCode)}.pdf`;
  return { blob: new Blob([bytes], { type: 'application/pdf' }), filename };
}

export async function createTechnicalReportPdfDownload(report: PrintableTechnicalReport) {
  const generated = await createTechnicalReportPdf(report);
  return { ...generated, url: URL.createObjectURL(generated.blob) };
}

export async function downloadTechnicalReportPdf(report: PrintableTechnicalReport) {
  if (typeof document === 'undefined') return false;
  const generated = await createTechnicalReportPdfDownload(report);
  const anchor = document.createElement('a');
  anchor.href = generated.url;
  anchor.download = generated.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(generated.url), 30_000);
  return true;
}
