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
const ROWS_PER_PAGE = 12;

type Rgb = [number, number, number];

type PayrollAccountingPdfOptions = {
  filename: string;
  periodLabel: string;
  summaries: PayrollEmployeeSummary[];
};

type Column = {
  key: 'employee' | 'weeklyBase' | 'overtime' | 'ao' | 'vacation' | 'noWork';
  label: string;
  width: number;
  align?: 'left' | 'center' | 'right';
};

const COLUMNS: Column[] = [
  { key: 'employee', label: 'Employee', width: 275, align: 'left' },
  { key: 'weeklyBase', label: 'Weekly Base', width: 105, align: 'center' },
  { key: 'overtime', label: 'Overtime', width: 90, align: 'center' },
  { key: 'ao', label: 'AO / Sick', width: 80, align: 'center' },
  { key: 'vacation', label: 'Vacation', width: 105, align: 'center' },
  { key: 'noWork', label: 'No Work / No Pay', width: CONTENT_WIDTH - 655, align: 'center' },
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

function textWidth(value: string, size: number) {
  return Array.from(value).reduce((width, character) => width + (character === ' ' ? size * 0.27 : size * 0.52), 0);
}

function truncate(value: string, maxLength: number) {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(1, maxLength - 3))}...`;
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

function buildAccountingPages(periodLabel: string, summaries: PayrollEmployeeSummary[]) {
  const groups: PayrollEmployeeSummary[][] = [];
  for (let index = 0; index < summaries.length; index += ROWS_PER_PAGE) groups.push(summaries.slice(index, index + ROWS_PER_PAGE));
  if (!groups.length) groups.push([]);

  const totals = {
    weeklyBase: summaries.reduce((sum, item) => sum + item.weeklyPaidBaseHours, 0),
    overtime: summaries.reduce((sum, item) => sum + item.overtimeHours, 0),
    ao: summaries.reduce((sum, item) => sum + item.aoHours, 0),
    vacation: summaries.reduce((sum, item) => sum + item.vacationHours, 0),
    noWork: summaries.reduce((sum, item) => sum + item.noWorkNoPayHours, 0),
  };

  return groups.map((group, pageIndex) => {
    const commands: string[] = [];
    const topToY = (top: number, height = 0) => PAGE_HEIGHT - top - height;

    function fillRect(x: number, top: number, width: number, height: number, fill: Rgb, stroke?: Rgb) {
      commands.push(`${color(fill)} rg`);
      if (stroke) {
        commands.push(`${color(stroke)} RG 0.7 w`);
        commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re B`);
      } else {
        commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re f`);
      }
    }

    function line(x1: number, top1: number, x2: number, top2: number, stroke: Rgb, width = 1) {
      commands.push(`${color(stroke)} RG ${number(width)} w`);
      commands.push(`${number(x1)} ${number(topToY(top1))} m ${number(x2)} ${number(topToY(top2))} l S`);
    }

    function drawText(
      value: string | number,
      x: number,
      top: number,
      size: number,
      options?: { bold?: boolean; fill?: Rgb; align?: 'left' | 'center' | 'right'; width?: number },
    ) {
      const text = String(value ?? '');
      const align = options?.align ?? 'left';
      const availableWidth = options?.width ?? 0;
      let resolvedX = x;
      if (align === 'center') resolvedX = x + Math.max(0, (availableWidth - textWidth(text, size)) / 2);
      if (align === 'right') resolvedX = x + Math.max(0, availableWidth - textWidth(text, size));
      commands.push(`${color(options?.fill ?? TEXT)} rg`);
      commands.push(`BT /${options?.bold ? 'F2' : 'F1'} ${number(size)} Tf ${number(resolvedX)} ${number(topToY(top, size))} Td ${pdfString(text)} Tj ET`);
    }

    fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, WHITE);
    fillRect(MARGIN, 23, 42, 42, BLUE);
    drawText('D', MARGIN, 29, 22, { bold: true, fill: WHITE, align: 'center', width: 42 });
    drawText('DEMAC', MARGIN + 54, 25, 22, { bold: true, fill: NAVY });
    drawText('PROFESSIONAL COOLING SOLUTIONS', MARGIN + 55, 49, 7.4, { bold: true, fill: BLUE_DARK });
    drawText('PAYROLL INPUT SUMMARY - ACCOUNTING', MARGIN, 80, 12, { bold: true, fill: NAVY });
    drawText('Compact monthly control report. Statutory payroll is completed by Accounting.', MARGIN, 98, 7.4, { fill: MUTED });
    drawText('Payroll period', PAGE_WIDTH - MARGIN - 285, 28, 7.4, { bold: true, fill: MUTED, align: 'right', width: 285 });
    drawText(periodLabel, PAGE_WIDTH - MARGIN - 285, 43, 10, { bold: true, fill: NAVY, align: 'right', width: 285 });
    drawText(`Generated ${new Date().toLocaleDateString('en-AW')}`, PAGE_WIDTH - MARGIN - 285, 59, 7.2, { fill: MUTED, align: 'right', width: 285 });
    fillRect(MARGIN, 114, CONTENT_WIDTH, 3, BLUE);

    let x = MARGIN;
    const headerTop = 132;
    const headerHeight = 34;
    COLUMNS.forEach((column) => {
      fillRect(x, headerTop, column.width, headerHeight, BLUE_LIGHT, BORDER);
      drawText(column.label, x + 7, headerTop + 12, column.key === 'noWork' ? 7.2 : 8.2, {
        bold: true,
        fill: BLUE_DARK,
        align: column.align,
        width: column.width - 14,
      });
      x += column.width;
    });

    const rowHeight = 31;
    group.forEach((summary, rowIndex) => {
      const top = headerTop + headerHeight + rowIndex * rowHeight;
      const fill = rowIndex % 2 === 0 ? WHITE : LIGHT_GRAY;
      x = MARGIN;
      COLUMNS.forEach((column) => {
        fillRect(x, top, column.width, rowHeight, fill, BORDER);
        if (column.key === 'employee') {
          drawText(truncate(summary.employee.name ?? 'Employee', 40), x + 8, top + 6, 9.2, { bold: true, fill: NAVY });
          drawText(truncate(`${summary.employee.role ?? summary.employee.employeeType ?? 'Employee'} · ${formatStartDate(summary)}`, 68), x + 8, top + 18, 6.8, { fill: MUTED });
        } else {
          const values = {
            weeklyBase: summary.weeklyPaidBaseHours,
            overtime: summary.overtimeHours,
            ao: summary.aoHours,
            vacation: summary.vacationHours,
            noWork: summary.noWorkNoPayHours,
          };
          const display = column.key === 'weeklyBase' ? formatWeeklyBase(values[column.key]) : formatHoursMinutes(values[column.key]);
          drawText(display, x + 7, top + 11, 8.4, {
            bold: column.key === 'weeklyBase' || values[column.key] > 0,
            fill: values[column.key] > 0 && column.key !== 'weeklyBase' ? NAVY : TEXT,
            align: column.align,
            width: column.width - 14,
          });
        }
        x += column.width;
      });
    });

    const isLastPage = pageIndex === groups.length - 1;
    if (isLastPage) {
      const top = headerTop + headerHeight + group.length * rowHeight;
      x = MARGIN;
      COLUMNS.forEach((column) => {
        fillRect(x, top, column.width, rowHeight, BLUE_LIGHT, BORDER);
        if (column.key === 'employee') {
          drawText('TOTALS', x + 8, top + 10, 9, { bold: true, fill: BLUE_DARK });
        } else {
          const value = totals[column.key];
          const display = column.key === 'weeklyBase' ? formatWeeklyBase(value) : formatHoursMinutes(value);
          drawText(display, x + 7, top + 10, 8.5, { bold: true, fill: BLUE_DARK, align: column.align, width: column.width - 14 });
        }
        x += column.width;
      });
    }

    if (!group.length) drawText('No employees are included in the selected payroll period.', MARGIN, 190, 11, { fill: MUTED });

    line(MARGIN, PAGE_HEIGHT - 33, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 33, BORDER, 0.6);
    drawText('Weekly Base is derived from the configured schedule. Overtime, AO/Sick, Vacation and NWNP are payroll exceptions.', MARGIN, PAGE_HEIGHT - 25, 7.1, { fill: MUTED });
    drawText(`Page ${pageIndex + 1} of ${groups.length}`, PAGE_WIDTH - MARGIN - 90, PAGE_HEIGHT - 25, 7.1, { fill: MUTED, align: 'right', width: 90 });
    return commands.join('\n');
  });
}

function buildPdf(pageStreams: string[]) {
  const objects: Uint8Array[] = [];
  const pageObjectNumbers = pageStreams.map((_, index) => 5 + index * 2);
  objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = asciiBytes(`<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(' ')}] /Count ${pageStreams.length} >>`);
  objects[3] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects[4] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pageStreams.forEach((stream, index) => {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    objects[pageObject] = asciiBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(PAGE_WIDTH)} ${number(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`);
    const streamBytes = asciiBytes(stream);
    objects[contentObject] = concatBytes([
      asciiBytes(`<< /Length ${streamBytes.length} >>\nstream\n`),
      streamBytes,
      asciiBytes('\nendstream'),
    ]);
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
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    xrefLines.push(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n `);
  }
  chunks.push(asciiBytes(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatBytes(chunks);
}

export function downloadPayrollAccountingPdf({ filename, periodLabel, summaries }: PayrollAccountingPdfOptions) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const pdf = buildPdf(buildAccountingPages(periodLabel, summaries));
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
