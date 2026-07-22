import { PayrollEmployeeSummary } from '../payroll/types';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const GREEN: [number, number, number] = [0.14, 0.65, 0.11];
const DARK_GREEN: [number, number, number] = [0.11, 0.49, 0.09];
const LIGHT_GREEN: [number, number, number] = [0.91, 0.97, 0.90];
const TEXT: [number, number, number] = [0.09, 0.13, 0.17];
const MUTED: [number, number, number] = [0.39, 0.44, 0.48];
const BORDER: [number, number, number] = [0.85, 0.88, 0.90];
const LIGHT_GRAY: [number, number, number] = [0.97, 0.98, 0.98];

interface PayrollPdfOptions {
  filename: string;
  periodLabel: string;
  summaries: PayrollEmployeeSummary[];
}

type Rgb = [number, number, number];

function formatHours(value: number) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 3))}...`;
}

function createPageCommands(pageNumber: number, pageCount: number) {
  const commands: string[] = [];
  const topToY = (top: number, height = 0) => PAGE_HEIGHT - top - height;

  function fillRect(x: number, top: number, width: number, height: number, fill: Rgb, stroke?: Rgb) {
    commands.push(`${color(fill)} rg`);
    if (stroke) {
      commands.push(`${color(stroke)} RG 0.8 w`);
      commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re B`);
    } else commands.push(`${number(x)} ${number(topToY(top, height))} ${number(width)} ${number(height)} re f`);
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

  function drawHeader(periodLabel: string) {
    drawText('DEMAC', MARGIN, 34, 23, { bold: true });
    drawText('Professional Cooling Solutions - Resumen de payroll', MARGIN, 61, 9.5, { fill: MUTED });
    drawText('Período de nómina', PAGE_WIDTH - MARGIN - 200, 35, 8, { bold: true, fill: MUTED, align: 'right', width: 200 });
    drawText(periodLabel, PAGE_WIDTH - MARGIN - 250, 51, 10, { bold: true, align: 'right', width: 250 });
    fillRect(MARGIN, 76, PAGE_WIDTH - MARGIN * 2, 4, GREEN);
  }

  function drawFooter() {
    line(MARGIN, PAGE_HEIGHT - 37, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 37, BORDER, 0.7);
    drawText('Generado por DEMAC Corporation - Factor mensual 4.333 - Período 27-26', MARGIN, PAGE_HEIGHT - 29, 7.3, { fill: MUTED });
    drawText(`Página ${pageNumber} de ${pageCount}`, PAGE_WIDTH - MARGIN - 100, PAGE_HEIGHT - 29, 7.3, { fill: MUTED, align: 'right', width: 100 });
  }

  return { commands, fillRect, line, drawText, drawHeader, drawFooter };
}

function buildPayrollPages(periodLabel: string, summaries: PayrollEmployeeSummary[]) {
  const totalBase = summaries.reduce((sum, item) => sum + item.monthlyBaseHours, 0);
  const totalOt = summaries.reduce((sum, item) => sum + item.overtimeHours, 0);
  const totalAo = summaries.reduce((sum, item) => sum + item.aoHours, 0);
  const totalVacation = summaries.reduce((sum, item) => sum + item.vacationHours, 0);
  const totalNwnp = summaries.reduce((sum, item) => sum + item.noWorkNoPayHours, 0);

  const firstPageCapacity = 4;
  const otherPageCapacity = 5;
  const pageGroups: PayrollEmployeeSummary[][] = [];
  pageGroups.push(summaries.slice(0, firstPageCapacity));
  for (let index = firstPageCapacity; index < summaries.length; index += otherPageCapacity) {
    pageGroups.push(summaries.slice(index, index + otherPageCapacity));
  }
  if (!pageGroups.length) pageGroups.push([]);

  return pageGroups.map((group, pageIndex) => {
    const page = createPageCommands(pageIndex + 1, pageGroups.length);
    page.drawHeader(periodLabel);

    let cardTop = 98;
    if (pageIndex === 0) {
      const labels = ['Empleados', 'Base mensual', 'Overtime', 'AO / Vacaciones', 'NWNP'];
      const values = [summaries.length, formatHours(totalBase), formatHours(totalOt), formatHours(totalAo + totalVacation), formatHours(totalNwnp)];
      const gap = 7;
      const width = (PAGE_WIDTH - MARGIN * 2 - gap * 4) / 5;
      labels.forEach((label, index) => {
        const x = MARGIN + index * (width + gap);
        page.fillRect(x, 95, width, 59, LIGHT_GRAY, BORDER);
        page.drawText(label, x + 8, 108, 6.8, { bold: true, fill: MUTED });
        page.drawText(values[index], x + 8, 127, 13, { bold: true });
      });
      cardTop = 170;
    }

    const cardHeight = 122;
    const cardGap = 9;
    const cardWidth = PAGE_WIDTH - MARGIN * 2;
    const metricGap = 6;
    const metricWidth = (cardWidth - 24 - metricGap * 3) / 4;

    group.forEach((summary, index) => {
      const top = cardTop + index * (cardHeight + cardGap);
      page.fillRect(MARGIN, top, cardWidth, cardHeight, [1, 1, 1], BORDER);
      page.drawText(truncate(summary.employee.name, 36), MARGIN + 12, top + 13, 13, { bold: true });
      page.drawText(`${truncate(summary.employee.role, 30)} - ${summary.employee.employeeType}`, MARGIN + 12, top + 31, 7.8, { fill: MUTED });

      const badgeWidth = 104;
      page.fillRect(PAGE_WIDTH - MARGIN - badgeWidth - 12, top + 10, badgeWidth, 23, LIGHT_GREEN);
      page.drawText(`Base mes: ${formatHours(summary.monthlyBaseHours)} h`, PAGE_WIDTH - MARGIN - badgeWidth - 12, top + 16, 7.5, {
        bold: true,
        fill: DARK_GREEN,
        align: 'center',
        width: badgeWidth,
      });
      page.line(MARGIN + 12, top + 42, PAGE_WIDTH - MARGIN - 12, top + 42, BORDER, 0.6);

      const metrics: Array<{ label: string; value: number; payable?: boolean }> = [
        { label: 'Base semanal', value: summary.weeklyRegularHours },
        { label: 'Base mensual', value: summary.monthlyBaseHours },
        { label: 'Laboradas', value: summary.actualRegularHours },
        { label: 'Overtime', value: summary.overtimeHours },
        { label: 'AO', value: summary.aoHours },
        { label: 'Vacaciones', value: summary.vacationHours },
        { label: 'No Work No Pay', value: summary.noWorkNoPayHours },
        { label: 'Horas pagables', value: summary.payableHours, payable: true },
      ];

      metrics.forEach((metric, metricIndex) => {
        const column = metricIndex % 4;
        const row = Math.floor(metricIndex / 4);
        const x = MARGIN + 12 + column * (metricWidth + metricGap);
        const metricTop = top + 50 + row * 32;
        page.fillRect(x, metricTop, metricWidth, 27, metric.payable ? LIGHT_GREEN : LIGHT_GRAY);
        page.drawText(metric.label, x + 6, metricTop + 6, 6.2, { bold: true, fill: MUTED });
        page.drawText(formatHours(metric.value), x + 6, metricTop + 16, 9.5, { bold: true, fill: metric.payable ? DARK_GREEN : TEXT });
      });
    });

    if (!group.length) {
      page.drawText('No hay empleados activos en este período.', MARGIN, 145, 12, { fill: MUTED });
    }

    page.drawFooter();
    return page.commands.join('\n');
  });
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
    const chunk = concatBytes([
      asciiBytes(`${objectNumber} 0 obj\n`),
      objects[objectNumber],
      asciiBytes('\nendobj\n'),
    ]);
    chunks.push(chunk);
    cursor += chunk.length;
  }

  const xrefOffset = cursor;
  const xrefLines = [`xref`, `0 ${objects.length}`, '0000000000 65535 f '];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    xrefLines.push(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n `);
  }
  chunks.push(asciiBytes(`${xrefLines.join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatBytes(chunks);
}

export function downloadPayrollSummaryPdf({ filename, periodLabel, summaries }: PayrollPdfOptions) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const pdf = buildPdf(buildPayrollPages(periodLabel, summaries));
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}
