export type PrintableReportField = {
  label: string;
  value?: string;
  photoUrl?: string;
  photoCaption?: string;
};

export type PrintableReportSection = {
  title: string;
  status: string;
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
  reportDate: string;
  observation?: string;
  sections: PrintableReportSection[];
};

export type PrintableReportDownload = {
  url: string;
  filename: string;
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
    return parsed.protocol === 'https:' || parsed.protocol === 'blob:' ? value : '';
  } catch {
    return '';
  }
}

function sectionHtml(section: PrintableReportSection) {
  const fields = section.fields.map((field) => {
    const photoUrl = safeUrl(field.photoUrl);
    if (photoUrl) {
      return `
        <figure class="photo-field">
          <div class="photo-title">${escapeHtml(field.label)}</div>
          <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(field.label)}" />
          ${field.photoCaption && field.photoCaption !== field.label ? `<figcaption>${escapeHtml(field.photoCaption)}</figcaption>` : ''}
        </figure>`;
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
        <h2>${escapeHtml(section.title)}</h2>
        <div class="status">${escapeHtml(section.status)}</div>
      </div>
      <div class="fields">${fields}</div>
    </section>`;
}

export function createReportPrintWindow() {
  if (typeof window === 'undefined') return null;
  const popup = window.open('', '_blank');
  if (popup) {
    popup.document.write('<!doctype html><html><head><title>Preparando reporte DEMAC</title></head><body style="font-family:Arial;padding:32px">Preparando reporte técnico y archivo PDF…</body></html>');
    popup.document.close();
  }
  return popup;
}

export function renderPrintableTechnicalReport(
  report: PrintableTechnicalReport,
  targetWindow?: Window | null,
  download?: PrintableReportDownload,
) {
  if (typeof window === 'undefined') return false;
  const popup = targetWindow ?? window.open('', '_blank');
  if (!popup) return false;

  const sections = report.sections.map(sectionHtml).join('');
  const observation = report.observation ? `
    <section class="observation">
      <h2>OBSERVACIONES</h2>
      <div>${escapeHtml(report.observation)}</div>
    </section>` : '';
  const downloadUrl = safeUrl(download?.url);
  const downloadButton = downloadUrl
    ? `<a class="download" href="${escapeHtml(downloadUrl)}" download="${escapeHtml(download?.filename || 'reporte-tecnico-demac.pdf')}">Descargar PDF</a>`
    : '<button class="download disabled" disabled>Preparando PDF…</button>';

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
    .toolbar { position: sticky; top: 0; z-index: 3; display: flex; gap: 10px; justify-content: flex-end; padding: 12px 24px; background: #ffffff; border-bottom: 1px solid #dce3ea; }
    button, .download { border: 0; border-radius: 8px; padding: 11px 16px; font-weight: 800; cursor: pointer; text-decoration: none; font-size: 13px; }
    .print { background: #edf2f7; color: #16202c; }
    .download { background: #11951b; color: white; }
    .download.disabled { opacity: .55; }
    .close { background: #e9edf2; color: #16202c; }
    .document { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 16mm; background: white; box-shadow: 0 4px 20px rgba(0,0,0,.12); }
    .brand { color: #0755b7; font-size: 13px; font-weight: 900; letter-spacing: 1.4px; }
    h1 { margin: 7px 0 4px; font-size: 27px; }
    .subtitle { color: #5c6673; margin-bottom: 18px; }
    .summary { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; padding: 13px; background: #f4f7fa; border-radius: 10px; }
    .summary-item { min-width: 0; }
    .summary-label, .field-label { color: #657180; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .5px; }
    .summary-value { font-size: 12px; font-weight: 700; margin-top: 4px; overflow-wrap: anywhere; }
    .report-section { margin-top: 18px; border-top: 2px solid #0a59bd; padding-top: 10px; }
    .section-header { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; break-after: avoid; }
    h2 { margin: 0; font-size: 16px; }
    .status { color: #24732f; background: #eaf7ec; border-radius: 999px; padding: 5px 9px; font-size: 9px; font-weight: 800; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; margin-top: 10px; }
    .text-field, .photo-field { border: 1px solid #e0e5ea; border-radius: 9px; padding: 9px; break-inside: avoid; }
    .field-value { margin-top: 5px; font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .photo-field { grid-column: span 2; margin: 0; }
    .photo-title { color: #0755b7; font-size: 13px; font-weight: 900; margin-bottom: 8px; }
    .photo-field img { display: block; width: 100%; max-height: 245mm; object-fit: contain; background: #f2f4f6; border-radius: 7px; }
    figcaption { color: #16202c; font-size: 10px; font-weight: 800; margin-top: 7px; }
    .observation { margin-top: 20px; border: 1px solid #0a59bd; background: #f4f8fd; padding: 12px; border-radius: 10px; line-height: 1.55; break-inside: avoid; }
    .footer { margin-top: 22px; color: #657180; font-size: 9px; text-align: center; }
    @page { size: A4; margin: 10mm; }
    @media print {
      body { background: white; }
      .toolbar { display: none; }
      .document { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
      .photo-field, .text-field, .section-header, .observation { break-inside: avoid; }
    }
    @media (max-width: 760px) {
      .document { width: calc(100% - 16px); margin: 8px; padding: 16px; }
      .summary, .fields { grid-template-columns: 1fr; }
      .photo-field { grid-column: span 1; }
      .toolbar { padding: 10px; flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="close" onclick="window.close()">Cerrar</button>
    <button class="print" onclick="window.print()">Imprimir</button>
    ${downloadButton}
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
      <div class="summary-item"><div class="summary-label">Fecha del reporte</div><div class="summary-value">${escapeHtml(report.reportDate)}</div></div>
    </div>
    ${sections}
    ${observation}
    <div class="footer">Reporte técnico generado por DEMAC Professional Cooling Solutions.</div>
  </main>
</body>
</html>`);
  popup.document.close();
  popup.focus();
  return true;
}
