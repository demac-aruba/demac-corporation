'use strict';
const { fault } = require('./quickbooksConnectionService');
// Same strict, lossless projection as sandbox; production keeps an independent release package.
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function normalizeReport(data, input) {
  const fail = () => { throw fault(502, 'invalid-report-response'); };
  const str = (value, max = 1000) => typeof value === 'string' && value.length <= max ? value : fail();
  const header = data?.Header;
  if (!header || header.ReportName !== input.report || !/^[A-Z]{3}$/.test(header.Currency || '') ||
    !validDate(header.EndPeriod) || header.EndPeriod !== input.endDate ||
    (input.report === 'ProfitAndLoss' && header.StartPeriod !== input.startDate) ||
    (header.ReportBasis && header.ReportBasis !== input.basis)) fail();
  const sourceColumns = data.Columns?.Column;
  if (!Array.isArray(sourceColumns) || sourceColumns.length < 1 || sourceColumns.length > 24) fail();
  const columns = sourceColumns.map(column => {
    if (column.Columns) fail(); // Fail explicitly instead of silently dropping nested columns.
    return { title: str(column.ColTitle ?? ''), type: str(column.ColType, 80) };
  });
  const rows = [];
  const append = (cells, kind, depth) => {
    if (!Array.isArray(cells) || cells.length !== columns.length || rows.length >= 2000) fail();
    rows.push({ kind, depth, values: cells.map(cell => str(cell.value)) });
  };
  const walk = (container, depth) => {
    if (depth > 12 || !container || !Array.isArray(container.Row)) fail();
    for (const row of container.Row) {
      if (!row || typeof row !== 'object') fail();
      // Intuit's A/P example omits type on leaf and summary rows; validate their full shape.
      const type = row.type ?? (row.ColData ? 'Data' : 'Section');
      if (!['Section', 'Data'].includes(type)) fail();
      if (type === 'Data') {
        if (row.Header || row.Summary || row.Rows) fail();
        append(row.ColData, 'data', depth);
      } else {
        if (row.ColData || (!row.Header && !row.Summary && !row.Rows)) fail();
        if (row.Header) append(row.Header.ColData, 'heading', depth);
        if (row.Rows) walk(row.Rows, depth + 1);
        if (row.Summary) append(row.Summary.ColData, 'total', depth);
      }
    }
  };
  const options = header.Option ?? [];
  if (!Array.isArray(options)) fail();
  const empty = options.find(option => option.Name === 'NoReportData')?.Value;
  if (empty !== undefined && !['true', 'false'].includes(empty)) fail();
  if (data.Rows?.Row) walk(data.Rows, 0);
  else if (empty !== 'true') fail();
  if (rows.length === 0 && empty !== 'true') fail();
  return { name: input.report, currency: header.Currency, basis: header.ReportBasis ? str(header.ReportBasis, 20) : null,
    startPeriod: validDate(header.StartPeriod) ? header.StartPeriod : null, endPeriod: header.EndPeriod,
    generatedAt: header.Time ? str(header.Time, 80) : null, noData: empty === 'true', columns, rows };
}

module.exports = { validDate, normalizeReport };
