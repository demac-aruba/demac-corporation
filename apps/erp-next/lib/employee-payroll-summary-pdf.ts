const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;

export type EmployeePayrollPdfSummary = {
  employee: {
    name?: string;
    role?: string;
    employeeType?: string;
  };
  vanLabel: string;
  scheduled: number;
  regular: number;
  overtime: number;
  ao: number;
  vacation: number;
  nwnp: number;
  paidFree: number;
  advances: number;
  lateMinutes: number;
  exceptionDays: number;
  recordedDays: number;
};

export type EmployeePayrollPdfPeriod = {
  start: string;
  end: string;
};

type PayrollPdfOptions = {
  period: EmployeePayrollPdfPeriod;
  summaries: EmployeePayrollPdfSummary[];
};

function formatHours(value: number) {
  return `${Math.max(0, Number(value) || 0).toFixed(2)} h`;
}

function formatMoney(value: number) {
  return `Afl. ${Math.max(0, Number(value) || 0).toLocaleString('en-AW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPeriodDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-AW', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
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
  context.font = options.font ?? '22px Arial';
  context.fillStyle = options.color ?? '#10233f';
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
  roundedRect(context, x, y, width, 76, 12);
  context.fillStyle = '#f6f8fb';
  context.fill();
  context.strokeStyle = '#dbe3ed';
  context.lineWidth = 2;
  context.stroke();
  drawText(context, label.toUpperCase(), x + 14, y + 26, { font: '700 14px Arial', color: '#617087' });
  drawText(context, value, x + 14, y + 57, { font: '800 23px Arial', color: '#10233f', maxWidth: width - 24 });
}

function drawEmployeeCard(
  context: CanvasRenderingContext2D,
  summary: EmployeePayrollPdfSummary,
  x: number,
  y: number,
  width: number,
) {
  const height = 418;
  roundedRect(context, x, y, width, height, 18);
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = '#d6dfeb';
  context.lineWidth = 2;
  context.stroke();

  const name = summary.employee.name?.trim() || 'Employee';
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  roundedRect(context, x + 20, y + 20, 62, 62, 31);
  context.fillStyle = '#eaf2ff';
  context.fill();
  drawText(context, initials, x + 51, y + 60, { font: '800 22px Arial', color: '#1263c6', align: 'center' });
  drawText(context, name, x + 101, y + 47, { font: '800 27px Arial', maxWidth: width - 270 });
  drawText(context, `${summary.employee.role ?? summary.employee.employeeType ?? 'Employee'} · ${summary.vanLabel || 'UNASSIGNED'}`, x + 101, y + 75, {
    font: '18px Arial',
    color: '#617087',
    maxWidth: width - 270,
  });

  roundedRect(context, x + width - 170, y + 28, 140, 42, 21);
  context.fillStyle = summary.recordedDays || summary.exceptionDays ? '#fff6e5' : '#edf8f1';
  context.fill();
  drawText(context, summary.recordedDays || summary.exceptionDays ? `${summary.exceptionDays} EXCEPTION${summary.exceptionDays === 1 ? '' : 'S'}` : 'REGULAR', x + width - 100, y + 55, {
    font: '800 14px Arial',
    color: summary.recordedDays || summary.exceptionDays ? '#9a6511' : '#277345',
    align: 'center',
  });

  const gap = 12;
  const metricWidth = (width - 40 - gap * 3) / 4;
  const rowOne = y + 104;
  const rowTwo = y + 190;
  const rowThree = y + 276;
  const metricX = (column: number) => x + 20 + (metricWidth + gap) * column;

  drawMetric(context, 'Scheduled', formatHours(summary.scheduled), metricX(0), rowOne, metricWidth);
  drawMetric(context, 'Regular', formatHours(summary.regular), metricX(1), rowOne, metricWidth);
  drawMetric(context, 'Overtime', formatHours(summary.overtime), metricX(2), rowOne, metricWidth);
  drawMetric(context, 'AO / Sick', formatHours(summary.ao), metricX(3), rowOne, metricWidth);

  drawMetric(context, 'Vacation', formatHours(summary.vacation), metricX(0), rowTwo, metricWidth);
  drawMetric(context, 'NWNP', formatHours(summary.nwnp), metricX(1), rowTwo, metricWidth);
  drawMetric(context, 'Paid Free', formatHours(summary.paidFree), metricX(2), rowTwo, metricWidth);
  drawMetric(context, 'Advances', formatMoney(summary.advances), metricX(3), rowTwo, metricWidth);

  drawMetric(context, 'Late', `${Math.max(0, Math.round(summary.lateMinutes || 0))} min`, metricX(0), rowThree, metricWidth);
  drawMetric(context, 'Exceptions', String(Math.max(0, summary.exceptionDays || 0)), metricX(1), rowThree, metricWidth);
  drawMetric(context, 'Manual Records', String(Math.max(0, summary.recordedDays || 0)), metricX(2), rowThree, metricWidth);
  drawMetric(context, 'Payroll Period', 'Included', metricX(3), rowThree, metricWidth);

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
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
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
  parts.push(textBytes(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatenate(parts);
}

function createPageCanvas(period: EmployeePayrollPdfPeriod, summaries: EmployeePayrollPdfSummary[], pageNumber: number, pageCount: number) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare payroll PDF.');

  context.fillStyle = '#f4f7fb';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  context.fillStyle = '#102a4c';
  context.fillRect(0, 0, PAGE_WIDTH, 126);
  drawText(context, 'DEMAC', 64, 72, { font: '900 40px Arial', color: '#ffffff' });
  drawText(context, 'Professional Cooling Solutions', 64, 103, { font: '19px Arial', color: '#d9e8fb' });
  drawText(context, 'PAYROLL / TIMESHEET SUMMARY', PAGE_WIDTH - 64, 67, { font: '900 27px Arial', color: '#ffffff', align: 'right' });
  drawText(context, `${formatPeriodDate(period.start)} – ${formatPeriodDate(period.end)}`, PAGE_WIDTH - 64, 101, { font: '19px Arial', color: '#d9e8fb', align: 'right' });

  drawText(context, 'Employee payroll inputs', 64, 174, { font: '900 31px Arial' });
  drawText(context, 'Automatic regular attendance plus payroll-relevant exceptions for the selected payroll period.', 64, 207, {
    font: '18px Arial',
    color: '#617087',
    maxWidth: PAGE_WIDTH - 128,
  });

  let y = 238;
  for (const summary of summaries) {
    y += drawEmployeeCard(context, summary, 64, y, PAGE_WIDTH - 128) + 20;
  }

  context.strokeStyle = '#d6dfeb';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(64, PAGE_HEIGHT - 72);
  context.lineTo(PAGE_WIDTH - 64, PAGE_HEIGHT - 72);
  context.stroke();
  drawText(context, `Generated ${new Date().toLocaleString('en-AW')}`, 64, PAGE_HEIGHT - 38, { font: '15px Arial', color: '#617087' });
  drawText(context, `Page ${pageNumber} of ${pageCount}`, PAGE_WIDTH - 64, PAGE_HEIGHT - 38, { font: '15px Arial', color: '#617087', align: 'right' });
  return canvas;
}

export function downloadEmployeePayrollSummaryPdf({ period, summaries }: PayrollPdfOptions) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const itemsPerPage = 3;
  const pages: EmployeePayrollPdfSummary[][] = [];
  for (let index = 0; index < summaries.length; index += itemsPerPage) pages.push(summaries.slice(index, index + itemsPerPage));
  if (!pages.length) pages.push([]);

  const jpegPages = pages.map((page, index) => canvasToJpegBytes(createPageCanvas(period, page, index + 1, pages.length)));
  const pdfBytes = createPdfFromJpegs(jpegPages);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `DEMAC-payroll-timesheet-summary-${period.start}-to-${period.end}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
