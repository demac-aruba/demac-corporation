export type PrintableReportField = {
  label: string;
  value?: string;
  photoUrl?: string;
  photoCaption?: string;
};

export type PrintableReportSection = {
  title: string;
  status: string;
  updatedByName?: string;
  fields: PrintableReportField[];
};

export type PrintableTechnicalReport = {
  reportTitle: string;
  reportCode: string;
  clientName: string;
  propertyName: string;
  address: string;
  workType: string;
  equipmentName: string;
  equipmentDetails: string;
  orderId: string;
  vanName: string;
  technicianNames: string;
  submittedBy: string;
  submittedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalNote?: string;
  sections: PrintableReportSection[];
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeUrl(value?: string) {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function sectionHtml(section: PrintableReportSection) {
  const fields = section.fields.map((field) => {
    const photoUrl = safeUrl(field.photoUrl);
    if (photoUrl) {
      return `
        <div class="photo-field">
          <div class="field-label">${escapeHtml(field.label)}</div>
          <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(field.label)}" />
          <div class="photo-caption">${escapeHtml(field.photoCaption || field.value || '')}</div>
        </div>`;
    }
    return `
      <div class="text-field">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="field-value">${escapeHtml(field.value || 'Sin información')}</div>
      </div>`;
  }).join('');

  return `
    <section class="report-section">
      <div class="section-header">
        <div>
          <h2>${escapeHtml(section.title)}</h2>
          <div class="section-meta">Última edición: ${escapeHtml(section.updatedByName || 'Sin registrar')}</div>
        </div>
        <div class="status">${escapeHtml(section.status)}</div>
      </div>
      <div class="fields">${fields}</div>
    </section>`;
}

export function createReportPrintWindow() {
  if (typeof window === 'undefined') return null;
  const popup = window.open('', '_blank');
  if (popup) {
    popup.document.write('<!doctype html><html><head><title>Preparando reporte DEMAC</title></head><body style="font-family:Arial;padding:32px">Preparando reporte técnico…</body></html>');
    popup.document.close();
  }
  return popup;
}

export function renderPrintableTechnicalReport(report: PrintableTechnicalReport, targetWindow?: Window | null) {
  if (typeof window === 'undefined') return false;
  const popup = targetWindow ?? window.open('', '_blank');
  if (!popup) return false;

  const sections = report.sections.map(sectionHtml).join('');
  const approval = report.approvedBy ? `
    <section class="approval">
      <h2>APROBACIÓN DE LA OFICINA</h2>
      <div><strong>Aprobado por:</strong> ${escapeHtml(report.approvedBy)}</div>
      <div><strong>Fecha:</strong> ${escapeHtml(report.approvedAt || '')}</div>
      ${report.approvalNote ? `<div><strong>Observación:</strong> ${escapeHtml(report.approvalNote)}</div>` : ''}
    </section>` : '';

  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.reportCode)} - Reporte técnico DEMAC</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #16202c; background: #eef2f6; }
    .toolbar { position: sticky; top: 0; z-index: 3; display: flex; gap: 12px; justify-content: flex-end; padding: 12px 24px; background: #ffffff; border-bottom: 1px solid #dce3ea; }
    button { border: 0; border-radius: 8px; padding: 11px 16px; font-weight: 700; cursor: pointer; }
    .print { background: #11951b; color: white; }
    .close { background: #e9edf2; color: #16202c; }
    .document { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 16mm; background: white; box-shadow: 0 4px 20px rgba(0,0,0,.12); }
    .brand { color: #0755b7; font-size: 13px; font-weight: 900; letter-spacing: 1.4px; }
    h1 { margin: 7px 0 4px; font-size: 27px; }
    .subtitle { color: #5c6673; margin-bottom: 18px; }
    .summary { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; padding: 13px; background: #f4f7fa; border-radius: 10px; }
    .summary-item { min-width: 0; }
    .summary-label, .field-label { color: #657180; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .5px; }
    .summary-value { font-size: 12px; font-weight: 700; margin-top: 4px; overflow-wrap: anywhere; }
    .report-section { margin-top: 18px; page-break-inside: avoid; border-top: 2px solid #0a59bd; padding-top: 10px; }
    .section-header { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    h2 { margin: 0; font-size: 16px; }
    .section-meta { color: #657180; font-size: 9px; margin-top: 4px; }
    .status { color: #24732f; background: #eaf7ec; border-radius: 999px; padding: 5px 9px; font-size: 9px; font-weight: 800; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-top: 10px; }
    .text-field, .photo-field { border: 1px solid #e0e5ea; border-radius: 9px; padding: 9px; page-break-inside: avoid; }
    .field-value { margin-top: 5px; font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .photo-field { grid-column: span 2; }
    .photo-field img { display: block; width: 100%; max-height: 190mm; object-fit: contain; margin-top: 8px; background: #f2f4f6; border-radius: 7px; }
    .photo-caption { color: #657180; font-size: 9px; margin-top: 5px; }
    .approval { margin-top: 20px; border: 2px solid #24732f; background: #f2faf3; padding: 12px; border-radius: 10px; line-height: 1.55; page-break-inside: avoid; }
    .footer { margin-top: 22px; color: #657180; font-size: 9px; text-align: center; }
    @page { size: A4; margin: 10mm; }
    @media print {
      body { background: white; }
      .toolbar { display: none; }
      .document { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
      .report-section { break-inside: avoid; }
    }
    @media (max-width: 760px) {
      .document { width: calc(100% - 16px); margin: 8px; padding: 16px; }
      .summary, .fields { grid-template-columns: 1fr; }
      .photo-field { grid-column: span 1; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="close" onclick="window.close()">Cerrar</button>
    <button class="print" onclick="window.print()">Imprimir / Guardar como PDF</button>
  </div>
  <main class="document">
    <div class="brand">DEMAC PROFESSIONAL COOLING SOLUTIONS</div>
    <h1>${escapeHtml(report.reportTitle)}</h1>
    <div class="subtitle">${escapeHtml(report.reportCode)}</div>
    <div class="summary">
      <div class="summary-item"><div class="summary-label">Cliente</div><div class="summary-value">${escapeHtml(report.clientName)}</div></div>
      <div class="summary-item"><div class="summary-label">Propiedad</div><div class="summary-value">${escapeHtml(report.propertyName)}</div></div>
      <div class="summary-item"><div class="summary-label">Dirección</div><div class="summary-value">${escapeHtml(report.address)}</div></div>
      <div class="summary-item"><div class="summary-label">Orden</div><div class="summary-value">${escapeHtml(report.orderId)}</div></div>
      <div class="summary-item"><div class="summary-label">Aire acondicionado</div><div class="summary-value">${escapeHtml(report.equipmentName)} · ${escapeHtml(report.equipmentDetails)}</div></div>
      <div class="summary-item"><div class="summary-label">Trabajo</div><div class="summary-value">${escapeHtml(report.workType)}</div></div>
      <div class="summary-item"><div class="summary-label">Van</div><div class="summary-value">${escapeHtml(report.vanName)}</div></div>
      <div class="summary-item"><div class="summary-label">Técnicos</div><div class="summary-value">${escapeHtml(report.technicianNames)}</div></div>
      <div class="summary-item"><div class="summary-label">Enviado por</div><div class="summary-value">${escapeHtml(report.submittedBy)}</div></div>
      <div class="summary-item"><div class="summary-label">Enviado</div><div class="summary-value">${escapeHtml(report.submittedAt)}</div></div>
    </div>
    ${sections}
    ${approval}
    <div class="footer">Reporte técnico generado por DEMAC · La evidencia fotográfica se incluye en resolución apta para impresión.</div>
  </main>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  return true;
}
