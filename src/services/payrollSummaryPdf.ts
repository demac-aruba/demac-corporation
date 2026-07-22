import { PayrollEmployeeSummary, PayrollPeriod } from '../payroll/types';

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;

interface PayrollPdfOptions {
  period: PayrollPeriod;
  summaries: PayrollEmployeeSummary[];
}

function formatHours(value: number) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: {
    font?: string;
    color?: string;
    align?: CanvasTextAlign;
    maxWidth?: number;
  } = {},
) {
  context.font = options.font ?? '24px Arial';
  context.fillStyle = options.color ?? '#17202A';
  context.textAlign = options.align ?? 'left';
  context.textBaseline = 'alphabetic';
  if (options.maxWidth) context.fillText(text, x, y, options.maxWidth);
  else context.fillText(text, x, y);
}

function drawMetric(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  roundedRect(context, x, y, width, 86, 14);
  context.fillStyle = '#F5F7F8';
  context.fill();
  context.strokeStyle = '#DCE2E6';
  context.lineWidth = 2;
  context.stroke();
  drawText(context, label.toUpperCase(), x + 18, y + 28, { font: '700 17px Arial', color: '#69757E' });
  drawText(context, value, x + 18, y + 64, { font: '800 28px Arial', color: '#17202A' });
}

function drawEmployeeCard(
  context: CanvasRenderingContext2D,
  summary: PayrollEmployeeSummary,
  x: number,
  y: number,
  width: number,
) {
  const height = 310;
  roundedRect(context, x, y, width, height, 18);
  context.fillStyle = '#FFFFFF';
  context.fill();
  context.strokeStyle = '#D8DEE3';
  context.lineWidth = 2;
  context.stroke();

  roundedRect(context, x + 20, y + 20, 64, 64, 32);
  context.fillStyle = '#E8F5E9';
  context.fill();
  const initials = summary.employee.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  drawText(context, initials, x + 52, y + 62, { font: '800 23px Arial', color: '#17841D', align: 'center' });
  drawText(context, summary.employee.name, x + 104, y + 50, { font: '800 28px Arial', maxWidth: width - 260 });
  drawText(context, `${summary.employee.role} · ${summary.employee.employeeType}`, x + 104, y + 78, {
    font: '19px Arial',
    color: '#69757E',
    maxWidth: width - 260,
  });

  roundedRect(context, x + width - 176, y + 26, 146, 44, 22);
  context.fillStyle = summary.changedDays ? '#E8F2FF' : '#F0F2F3';
  context.fill();
  drawText(context, summary.changedDays ? 'EN PROGRESO' : 'SIN CAMBIOS', x + width - 103, y + 55, {
    font: '800 15px Arial',
    color: summary.changedDays ? '#1769AA' : '#58636B',
    align: 'center',
  });

  const gap = 14;
  const metricWidth = (width - 40 - gap * 3) / 4;
  const rowOneY = y + 112;
  const rowTwoY = y + 210;
  drawMetric(context, 'Base semana', formatHours(summary.weeklyRegularHours), x + 20, rowOneY, metricWidth);
  drawMetric(context, 'Base mes', formatHours(summary.monthlyBaseHours), x + 20 + (metricWidth + gap), rowOneY, metricWidth);
  drawMetric(context, 'Laboradas', formatHours(summary.actualRegularHours), x + 20 + (metricWidth + gap) * 2, rowOneY, metricWidth);
  drawMetric(context, 'Overtime', formatHours(summary.overtimeHours), x + 20 + (metricWidth + gap) * 3, rowOneY, metricWidth);
  drawMetric(context, 'AO', formatHours(summary.aoHours), x + 20, rowTwoY, metricWidth);
  drawMetric(context, 'Vacaciones', formatHours(summary.vacationHours), x + 20 + (metricWidth + gap), rowTwoY, metricWidth);
  drawMetric(context, 'No Work No Pay', formatHours(summary.noWorkNoPayHours), x + 20 + (metricWidth + gap) * 2, rowTwoY, metricWidth);
  drawMetric(context, 'Pagables', formatHours(summary.payableHours), x + 20 + (metricWidth + gap) * 3, rowTwoY, metricWidth);

  return height;
}

function canvasToJpegBytes(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function concatenate(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function createPdfFromJpegs(images: Uint8Array[]) {
  const objectCount = 2 + images.length * 3;
  const objects: Array<Uint8Array | undefined> = new Array(objectCount + 1);
  const pageReferences = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  objects[1] = textBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = textBytes(`<< /Type /Pages /Kids [${pageReferences}] /Count ${images.length} >>`);

  images.forEach((image, index) => {
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const imageName = `Im${index + 1}`;
    const content = `q\n${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm\n/${imageName} Do\nQ`;
    objects[pageObject] = textBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects[contentObject] = textBytes(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objects[imageObject] = concatenate([
      textBytes(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),
      image,
      textBytes('\nendstream'),
    ]);
  });

  const header = concatenate([textBytes('%PDF-1.4\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), textBytes('\n')]);
  const parts: Uint8Array[] = [header];
  const offsets: number[] = new Array(objectCount + 1).fill(0);
  let currentOffset = header.length;
  for (let index = 1; index <= objectCount; index += 1) {
    const objectBody = objects[index] ?? textBytes('<< >>');
    const objectBytes = concatenate([textBytes(`${index} 0 obj\n`), objectBody, textBytes('\nendobj\n')]);
    offsets[index] = currentOffset;
    parts.push(objectBytes);
    currentOffset += objectBytes.length;
  }

  const xrefOffset = currentOffset;
  const xrefLines = ['xref', `0 ${objectCount + 1}`, '0000000000 65535 f '];
  for (let index = 1; index <= objectCount; index += 1) xrefLines.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  const trailer = `${xrefLines.join('\n')}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(textBytes(trailer));
  return concatenate(parts);
}

function createPageCanvas(period: PayrollPeriod, summaries: PayrollEmployeeSummary[], pageNumber: number, pageCount: number) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el PDF.');

  context.fillStyle = '#F5F7F8';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = '#16851C';
  context.fillRect(0, 0, PAGE_WIDTH, 116);
  drawText(context, 'DEMAC', 64, 72, { font: '900 40px Arial', color: '#FFFFFF' });
  drawText(context, 'Professional Cooling Solutions', 64, 101, { font: '20px Arial', color: '#DFF3E0' });
  drawText(context, 'RESUMEN DE PAYROLL', PAGE_WIDTH - 64, 66, { font: '900 29px Arial', color: '#FFFFFF', align: 'right' });
  drawText(context, period.label, PAGE_WIDTH - 64, 99, { font: '20px Arial', color: '#DFF3E0', align: 'right' });

  drawText(context, 'Resumen por empleado', 64, 168, { font: '900 32px Arial' });
  drawText(context, 'La base mensual utiliza el horario semanal configurado × 4.333. Las horas libres del beneficio semanal no se contabilizan.', 64, 202, {
    font: '18px Arial',
    color: '#5F6B73',
    maxWidth: PAGE_WIDTH - 128,
  });

  let y = 242;
  summaries.forEach((summary) => {
    const height = drawEmployeeCard(context, summary, 64, y, PAGE_WIDTH - 128);
    y += height + 24;
  });

  context.strokeStyle = '#D8DEE3';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(64, PAGE_HEIGHT - 72);
  context.lineTo(PAGE_WIDTH - 64, PAGE_HEIGHT - 72);
  context.stroke();
  drawText(context, `Generado ${new Date().toLocaleString('es-AW')}`, 64, PAGE_HEIGHT - 38, { font: '16px Arial', color: '#69757E' });
  drawText(context, `Página ${pageNumber} de ${pageCount}`, PAGE_WIDTH - 64, PAGE_HEIGHT - 38, { font: '16px Arial', color: '#69757E', align: 'right' });
  return canvas;
}

export function downloadPayrollSummaryPdf({ period, summaries }: PayrollPdfOptions) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const itemsPerPage = 4;
  const pages: PayrollEmployeeSummary[][] = [];
  for (let index = 0; index < summaries.length; index += itemsPerPage) pages.push(summaries.slice(index, index + itemsPerPage));
  if (!pages.length) pages.push([]);

  const jpegPages = pages.map((page, index) => canvasToJpegBytes(createPageCanvas(period, page, index + 1, pages.length)));
  const pdfBytes = createPdfFromJpegs(jpegPages);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `DEMAC_Resumen_Payroll_${period.startDate}_${period.endDate}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
