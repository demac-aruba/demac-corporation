import type { PayrollEmployeeSummary } from './employee-payroll';

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 30;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NAVY: Rgb = [0.04, 0.12, 0.22];
const BLUE: Rgb = [0.08, 0.38, 0.84];
const BLUE_DARK: Rgb = [0.05, 0.28, 0.65];
const BLUE_LIGHT: Rgb = [0.93, 0.96, 1];
const TEXT: Rgb = [0.08, 0.13, 0.2];
const MUTED: Rgb = [0.4, 0.47, 0.56];
const BORDER: Rgb = [0.84, 0.88, 0.93];
const LIGHT_GRAY: Rgb = [0.975, 0.982, 0.99];
const WHITE: Rgb = [1, 1, 1];

type Rgb = [number, number, number];

type PayrollAccountingPdfOptions = {
  filename: string;
  periodLabel: string;
  summaries: PayrollEmployeeSummary[];
  advancesByEmployee?: Record<string, number>;
  bonusesByEmployee?: Record<string, number>;
};

type Column = {
  key: 'employee' | 'weeklyBase' | 'overtime' | 'ao' | 'vacation' | 'noWork' | 'advance' | 'bonus' | 'rate150' | 'rate200';
  label: string[];
  width: number;
  align?: 'left' | 'center' | 'right';
};

const COLUMNS: Column[] = [
  { key: 'employee', label: ['Employee'], width: 216, align: 'left' },
  { key: 'weeklyBase', label: ['Weekly', 'Base'], width: 56, align: 'center' },
  { key: 'overtime', label: ['Total OT'], width: 68, align: 'center' },
  { key: 'rate150', label: ['Regular OT', '150%'], width: 76, align: 'center' },
  { key: 'rate200', label: ['Special OT', '200%'], width: 76, align: 'center' },
  { key: 'ao', label: ['AO / Sick'], width: 43, align: 'center' },
  { key: 'vacation', label: ['Vacation', 'Taken'], width: 48, align: 'center' },
  { key: 'noWork', label: ['No Work', '/ No Pay'], width: 52, align: 'center' },
  { key: 'advance', label: ['Salary', 'Advance'], width: 72, align: 'center' },
  { key: 'bonus', label: ['Bonuses', '(Afl.)'], width: CONTENT_WIDTH - 707, align: 'center' },
];

function formatWeeklyBase(value: number) {
  return `${Number(value || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

function formatHoursMinutes(value: number) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!wholeHours && !minutes) return '0 h';
  if (!wholeHours) return `${minutes} min`;
  if (!minutes) return `${wholeHours} h`;
  return `${wholeHours} h ${minutes} min`;
}

function formatMoney(value: number) {
  return `Afl. ${Number(value || 0).toLocaleString('en-AW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatStartDate(summary: PayrollEmployeeSummary) {
  const profile = summary.employee as PayrollEmployeeSummary['employee'] & { employmentStartedAt?: string; startDate?: string };
  const value = profile.employmentStartedAt ?? profile.startDate;
  if (!value) return 'Start date not recorded';
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return `Start: ${value}`;
  return `Start: ${parsed.toLocaleDateString('en-AW', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

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
    0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85,
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

// Standard Helvetica AFM widths (ASCII 32-126); accented Latin letters use their base glyph.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

function textWidth(value: string, size: number, bold = false) {
  const widths = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  return Array.from(value).reduce((width, character) => {
    const code = character.normalize('NFD').charCodeAt(0);
    return width + (widths[code - 32] ?? 600) * size / 1000;
  }, 0);
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

function buildAccountingPages(periodLabel: string, summaries: PayrollEmployeeSummary[], advancesByEmployee: Record<string, number>, bonusesByEmployee: Record<string, number>) {
  const headerTop = 118;
  const headerHeight = 32;
  // Keep the whole roster and totals together. Larger rosters use a taller single
  // sheet instead of losing employees, splitting categories, or shrinking text indefinitely.
  const rowCount = Math.max(1, summaries.length) + 1;
  const rowHeight = Math.min(26, Math.max(20, (PAGE_HEIGHT - 50 - headerTop - headerHeight) / rowCount));
  const pageHeight = Math.max(PAGE_HEIGHT, headerTop + headerHeight + rowCount * rowHeight + 50);
  const totals = {
    weeklyBase: summaries.reduce((sum, item) => sum + item.weeklyPaidBaseHours, 0),
    overtime: summaries.reduce((sum, item) => sum + item.overtimeHours, 0),
    rate150: summaries.reduce((sum, item) => sum + (item.overtime150Hours ?? 0), 0),
    rate200: summaries.reduce((sum, item) => sum + (item.overtime200Hours ?? 0), 0),
    ao: summaries.reduce((sum, item) => sum + item.aoHours, 0),
    vacation: summaries.reduce((sum, item) => sum + item.vacationHours, 0),
    noWork: summaries.reduce((sum, item) => sum + item.noWorkNoPayHours, 0),
    advance: summaries.reduce((sum, item) => sum + Number(advancesByEmployee[item.employee.id] ?? 0), 0),
    bonus: summaries.reduce((sum, item) => sum + Number(bonusesByEmployee[item.employee.id] ?? 0), 0),
  };

  const columns = COLUMNS;
  const commands: string[] = [];
  const topToY = (top: number, height = 0) => pageHeight - top - height;

  function fillRect(x: number, top: number, width: number, height: number, fill: Rgb, stroke?: Rgb) {
    commands.push(`${color(fill)} rg`);
    if (stroke) {
      commands.push(`${color(stroke)} RG 0.7 w`);
      commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re B`);
    } else commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re f`);
  }

  function line(x1: number, top1: number, x2: number, top2: number, stroke: Rgb, width = 1) {
    commands.push(`${color(stroke)} RG ${number(width)} w`);
    commands.push(`${number(x1)} ${number(topToY(top1))} m ${number(x2)} ${number(topToY(top2))} l S`);
  }

  function drawText(value: string | number, x: number, top: number, size: number, options?: { bold?: boolean; fill?: Rgb; align?: 'left' | 'center' | 'right'; width?: number }) {
    const text = String(value ?? '');
    if (options?.width) size = Math.min(size, size * options.width / Math.max(1, textWidth(text, size, options.bold)));
    const align = options?.align ?? 'left';
    const availableWidth = options?.width ?? 0;
    let resolvedX = x;
    if (align === 'center') resolvedX = x + Math.max(0, (availableWidth - textWidth(text, size, options?.bold)) / 2);
    if (align === 'right') resolvedX = x + Math.max(0, availableWidth - textWidth(text, size, options?.bold));
    commands.push(`${color(options?.fill ?? TEXT)} rg`);
    commands.push(`BT /${options?.bold ? 'F2' : 'F1'} ${number(size)} Tf ${number(resolvedX)} ${number(topToY(top, size))} Td ${pdfString(text)} Tj ET`);
  }

  fillRect(0, 0, PAGE_WIDTH, pageHeight, WHITE);
  fillRect(MARGIN, 23, 42, 42, BLUE);
  drawText('D', MARGIN, 29, 22, { bold: true, fill: WHITE, align: 'center', width: 42 });
  drawText('DEMAC', MARGIN + 54, 25, 22, { bold: true, fill: NAVY });
  drawText('PROFESSIONAL COOLING SOLUTIONS', MARGIN + 55, 49, 7.4, { bold: true, fill: BLUE_DARK });
  drawText('PAYROLL INPUT SUMMARY - ACCOUNTING', MARGIN, 80, 12, { bold: true, fill: NAVY });
  drawText('Period hours, overtime rates and adjustments in one employee row. Statutory payroll is completed by Accounting.', MARGIN, 98, 7.4, { fill: MUTED });
  drawText('Payroll period', PAGE_WIDTH - MARGIN - 285, 28, 7.4, { bold: true, fill: MUTED, align: 'right', width: 285 });
  drawText(periodLabel, PAGE_WIDTH - MARGIN - 285, 43, 10, { bold: true, fill: NAVY, align: 'right', width: 285 });
  drawText(`Generated ${new Date().toLocaleDateString('en-AW')}`, PAGE_WIDTH - MARGIN - 285, 59, 7.2, { fill: MUTED, align: 'right', width: 285 });
  fillRect(MARGIN, 110, CONTENT_WIDTH, 3, BLUE);

  let x = MARGIN;
  columns.forEach((column) => {
    fillRect(x, headerTop, column.width, headerHeight, BLUE_LIGHT, BORDER);
    column.label.forEach((label, index) => drawText(label, x + 4, headerTop + (column.label.length === 1 ? 12 : 6 + index * 11), 7.4, { bold: true, fill: BLUE_DARK, align: column.align, width: column.width - 8 }));
    x += column.width;
  });

  summaries.forEach((summary, rowIndex) => {
    const top = headerTop + headerHeight + rowIndex * rowHeight;
    const fill = rowIndex % 2 === 0 ? WHITE : LIGHT_GRAY;
    x = MARGIN;
    columns.forEach((column) => {
      fillRect(x, top, column.width, rowHeight, fill, BORDER);
      if (column.key === 'employee') {
        drawText(summary.employee.name ?? 'Employee', x + 6, top + 3, 8.3, { bold: true, fill: NAVY, width: column.width - 12 });
        drawText(`${summary.employee.role ?? summary.employee.employeeType ?? 'Employee'} · ${formatStartDate(summary)}`, x + 6, top + rowHeight - 9, 6.2, { fill: MUTED, width: column.width - 12 });
      } else if (column.key === 'advance' || column.key === 'bonus') {
        const value = Number((column.key === 'bonus' ? bonusesByEmployee : advancesByEmployee)[summary.employee.id] ?? 0);
        drawText(formatMoney(value), x + 5, top + (rowHeight - 7.6) / 2, 7.6, { bold: value > 0, fill: value > 0 ? BLUE_DARK : TEXT, align: column.align, width: column.width - 10 });
      } else {
        const values = { weeklyBase: summary.weeklyPaidBaseHours, overtime: summary.overtimeHours, rate150: summary.overtime150Hours ?? 0, rate200: summary.overtime200Hours ?? 0, ao: summary.aoHours, vacation: summary.vacationHours, noWork: summary.noWorkNoPayHours };
        const value = values[column.key];
        const display = column.key === 'weeklyBase' ? formatWeeklyBase(value) : formatHoursMinutes(value);
        drawText(display, x + 5, top + (rowHeight - 7.9) / 2, 7.9, { bold: column.key === 'weeklyBase' || value > 0, fill: value > 0 && column.key !== 'weeklyBase' ? NAVY : TEXT, align: column.align, width: column.width - 10 });
      }
      x += column.width;
    });
  });

  {
    const top = headerTop + headerHeight + Math.max(1, summaries.length) * rowHeight;
    x = MARGIN;
    columns.forEach((column) => {
      fillRect(x, top, column.width, rowHeight, BLUE_LIGHT, BORDER);
      if (column.key === 'employee') drawText('TOTALS', x + 8, top + (rowHeight - 8) / 2, 9, { bold: true, fill: BLUE_DARK });
      else if (column.key === 'advance' || column.key === 'bonus') drawText(formatMoney(totals[column.key]), x + 5, top + (rowHeight - 8) / 2, 7.7, { bold: true, fill: BLUE_DARK, align: column.align, width: column.width - 10 });
      else {
        const value = totals[column.key];
        const display = column.key === 'weeklyBase' ? formatWeeklyBase(value) : formatHoursMinutes(value);
        drawText(display, x + 5, top + (rowHeight - 8) / 2, 7.8, { bold: true, fill: BLUE_DARK, align: column.align, width: column.width - 10 });
      }
      x += column.width;
    });
  }

  if (!summaries.length) drawText('No employees are included in the selected payroll period.', MARGIN + 8, headerTop + headerHeight + 6, 9, { fill: MUTED });

  line(MARGIN, pageHeight - 38, PAGE_WIDTH - MARGIN, pageHeight - 38, BORDER, 0.6);
  drawText(summaries.some((s) => s.overtimeRateReviewRequired) ? 'REVIEW REQUIRED: overtime rate allocations conflict with recorded totals. Resolve in Employees before processing.' : 'Overtime and leave hours cover the selected period; Weekly Base is the configured weekly schedule. Advances/bonuses are Afl.; no automatic deductions.', MARGIN, pageHeight - 21, 6.7, { fill: MUTED, width: CONTENT_WIDTH - 65 });
  drawText('Page 1 of 1', PAGE_WIDTH - MARGIN - 90, pageHeight - 21, 7.1, { fill: MUTED, align: 'right', width: 90 });
  drawText('All time values are hours and minutes, including AO and vacation taken. Regular OT = 150%; Special OT = manually selected 200%.', MARGIN, pageHeight - 33, 6.7, { fill: MUTED, width: CONTENT_WIDTH });
  return [{ height: pageHeight, stream: commands.join('\n') }];
}

function buildPdf(pageStreams: { height: number; stream: string }[]) {
  const objects: Uint8Array[] = [];
  const pageObjectNumbers = pageStreams.map((_, index) => 5 + index * 2);
  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = asciiBytes(`<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(' ')}] /Count ${pageStreams.length} >>`);
  objects[3] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects[4] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pageStreams.forEach(({ height, stream }, index) => {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    objects[pageObject] = asciiBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(PAGE_WIDTH)} ${number(height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`);
    const streamBytes = asciiBytes(stream);
    objects[contentObject] = concatBytes([asciiBytes(`<< /Length ${streamBytes.length} >>\nstream\n`), streamBytes, asciiBytes('\nendstream')]);
  });

  const header = asciiBytes('%PDF-1.4\n%DEMAC\n');
  const chunks: Uint8Array[] = [header];
  const offsets: number[] = [0];
  let cursor = header.length;
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = cursor;
    const chunk = concatBytes([asciiBytes(`${objectNumber} 0 obj\n`), objects[objectNumber], asciiBytes('\nendobj\n')]);
    chunks.push(chunk);
    cursor += chunk.length;
  }

  const xrefOffset = cursor;
  const xrefLines = ['xref', `0 ${objects.length}`, '0000000000 65535 f '];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) xrefLines.push(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n `);
  chunks.push(asciiBytes(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatBytes(chunks);
}

export function buildPayrollAccountingPdf({ periodLabel, summaries, advancesByEmployee = {}, bonusesByEmployee = {} }: Omit<PayrollAccountingPdfOptions, 'filename'>) {
  return buildPdf(buildAccountingPages(periodLabel, summaries, advancesByEmployee, bonusesByEmployee));
}

export function downloadPayrollAccountingPdf({ filename, ...options }: PayrollAccountingPdfOptions) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const pdf = buildPayrollAccountingPdf(options);
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
