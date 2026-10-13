import type { ChargeRecord } from './appointment-charges';
import { appointmentChargeBalance } from './appointment-charge-balance';

type Options = { appointmentId: string; customer: string; dateKey: string; record: ChargeRecord };
const money = (cents: number) => `Afl. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Sin fecha registrada' : parsed.toLocaleString('es', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Standard PDF fonts use WinAnsi. Preserve unsupported characters visibly by
// code point rather than silently dropping or replacing customer/catalog text.
function printable(value: string) {
  return Array.from(value.normalize('NFC')).map(char => {
    const n = char.codePointAt(0)!;
    if (n === 10 || n === 13 || n === 9) return ' ';
    if (n >= 32 && n <= 126 || n >= 160 && n <= 255) return char;
    const punctuation: Record<string, string> = { '–': '-', '—': '-', '−': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '✓': '' };
    return punctuation[char] ?? `[U+${n.toString(16).toUpperCase()}]`;
  }).join('');
}
const pdfText = (value: string) => `(${Array.from(printable(value)).map(char => {
  const n = char.charCodeAt(0);
  return n > 126 ? `\\${n.toString(8).padStart(3, '0')}` : ['(', ')', '\\'].includes(char) ? `\\${char}` : char;
}).join('')})`;
function wrap(value: string, length: number) {
  const result: string[] = []; let line = '';
  for (const word of printable(value).split(/\s+/)) {
    if (!word) continue;
    if (line && line.length + word.length + 1 > length) { result.push(line); line = ''; }
    let rest = word;
    while (rest.length > length) { result.push(rest.slice(0, length)); rest = rest.slice(length); }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) result.push(line);
  return result.length ? result : [''];
}

export function buildAppointmentChargesPdf({ appointmentId, customer, dateKey, record }: Options, issuedAt = new Date().toISOString()): Uint8Array<ArrayBuffer> {
  const state = record.state, final = state?.final;
  const { totalCents, receivedCents, balanceCents } = appointmentChargeBalance(record);
  const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  const receipts = record.payments.filter(payment => payment.status === 'recorded');
  if (record.blocker || !final || final.currency !== 'AWG' || totalCents === null || receivedCents === null || balanceCents === null
    || !final.lines.length || final.lines.some(line => !integer(line.totalCents) || !integer(line.unitCents) || !integer(line.quantityMillis) || line.projectionOnly)
    || final.lines.reduce((sum, line) => sum + line.totalCents!, 0) !== totalCents
    || receipts.some(payment => !integer(payment.amountCents)) || receipts.reduce((sum, payment) => sum + payment.amountCents, 0) !== receivedCents) {
    throw Error('El PDF requiere trabajos confirmados y pagos conciliados. Actualiza los importes antes de descargar.');
  }
  // Browser-only document projection. No numbering, persistence, external fonts,
  // uploads, accounting writes or communications are performed by this module.
  const pages: string[][] = []; let commands: string[] = [], y = 0;
  const text = (value: string, x: number, top: number, size = 10, bold = false) => {
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 0.075 0.14 0.24 rg 1 0 0 1 ${x} ${842 - top} Tm ${pdfText(value)} Tj ET`);
  };
  const rule = (top: number) => commands.push(`0.83 0.88 0.95 RG 0.6 w 36 ${842 - top} m 559 ${842 - top} l S`);
  const newPage = () => {
    commands = []; pages.push(commands);
    commands.push('0.07 0.40 0.98 rg 36 808 523 4 re f');
    text('DEMAC', 36, 65, 22, true);
    text('Resumen de trabajos y pagos', 36, 90, 13, true);
    text('Comprobante operativo de la cita', 36, 108, 10);
    rule(120); y = 140;
    if (pages.length > 1) paragraph(`Cita: ${appointmentId}`, 9);
  };
  const ensure = (height: number) => { if (y + height > 766) newPage(); };
  const paragraph = (value: string, size = 10) => {
    for (const line of wrap(value, Math.floor(523 / (size * .6)))) { ensure(size + 5); text(line, 36, y, size); y += size + 5; }
  };
  const heading = (value: string) => { ensure(45); y += 12; text(value, 36, y, 12, true); y += 20; };
  const tableHeader = () => {
    ensure(32); commands.push(`0.93 0.96 1 rg 36 ${842 - y - 8} 523 24 re f`);
    text('Concepto', 42, y + 7, 9); text('Cant.', 337, y + 7, 9); text('Precio unit.', 383, y + 7, 9); text('Importe', 487, y + 7, 9); y += 30;
  };
  newPage();
  paragraph(`Cliente: ${customer}`); paragraph(`Cita: ${appointmentId}`);
  paragraph(`Fecha del servicio: ${dateKey || 'Sin fecha registrada'}`);
  paragraph(`Confirmado: ${date(final.capturedAt)} | Version del registro: ${state!.version}`);
  paragraph(`Emitido: ${date(issuedAt)} (Aruba)`);
  heading('Trabajos confirmados'); tableHeader();
  for (const line of final.lines) {
    const label = `${line.label}${line.btu ? ` | ${Number(line.btu).toLocaleString('en-US')} BTU` : ''}`;
    const parts = wrap(label, 47);
    for (let index = 0; index < parts.length; index++) {
      if (y + 20 > 766) { newPage(); tableHeader(); }
      text(parts[index], 42, y, 10);
      if (!index) {
        const quantity = String(line.quantityMillis / 1000), unit = money(line.unitCents!), total = money(line.totalCents!);
        text(quantity, 373 - quantity.length * 5.4, y, 9);
        text(unit, 464 - unit.length * 5.4, y, 9);
        text(total, 553 - total.length * 5.4, y, 9);
      }
      y += 15;
    }
    rule(y - 4); y += 8;
  }
  ensure(100); y += 10;
  for (const [label, value] of [['Monto final', totalCents], ['Total recibido', receivedCents], [balanceCents < 0 ? 'Saldo a favor' : 'Saldo pendiente', Math.abs(balanceCents)]] as const) {
    text(label, 300, y, 11, true); const formatted = money(value); text(formatted, 553 - formatted.length * 6.6, y, 11); y += 24;
  }
  ensure(100); heading('Pagos registrados');
  if (!record.payments.length) paragraph('No hay pagos registrados.');
  const methods: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia', pos: 'POS', suave: 'SUAVE' };
  for (const payment of record.payments) {
    ensure(65);
    paragraph(`${methods[payment.method] || payment.method} | ${money(payment.amountCents)} | ${payment.status === 'voided' ? 'ANULADO - no incluido en total' : 'Recibido'}`);
    paragraph(`${date(payment.receivedAt)} | Ref.: ${payment.reference || 'Sin referencia'}`, 9);
    y += 8;
  }
  ensure(50); y += 12;
  paragraph('Resumen de importes operativos confirmados. No sustituye la factura fiscal emitida por QuickBooks.', 9);
  pages.forEach((page, index) => { commands = page; rule(786); text('DEMAC | Importes en florines (AWG)', 36, 803, 8); text(`Pagina ${index + 1} de ${pages.length}`, 463, 803, 8); });

  // Same self-contained PDF mechanism as the existing payroll export, with
  // fixed-width body metrics for deterministic wrapping and exact byte offsets.
  const objects = ['', '<< /Type /Catalog /Pages 2 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids: string[] = [];
  pages.forEach(page => {
    const id = objects.length, stream = page.join('\n'); kids.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  let output = '%PDF-1.4\n%DEMAC\n'; const offsets = [0];
  for (let i = 1; i < objects.length; i++) { offsets[i] = output.length; output += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

export function downloadAppointmentChargesPdf(options: Options) {
  const bytes = buildAppointmentChargesPdf(options);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `DEMAC-trabajos-${options.appointmentId.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
