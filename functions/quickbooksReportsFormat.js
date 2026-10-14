'use strict';
const { fault } = require('./quickbooksConnectionService');
const VALIDATION_ISSUES = Object.freeze(['header_shape', 'header_name', 'header_currency', 'header_end_period',
  'header_start_period', 'header_basis', 'columns', 'column_shape', 'column_title', 'column_type',
  'cell_count', 'cell_value', 'row_limit', 'row_depth', 'rows_shape', 'row_shape', 'row_type',
  'header_options', 'no_report_data', 'missing_rows', 'empty_rows', 'header_time']);
// Only a fixed classification may cross HTTP/logging boundaries; never values or paths.
function reportValidationIssue(error) {
  return error?.safeCode === 'invalid-report-response' && VALIDATION_ISSUES.includes(error.validationIssue)
    ? error.validationIssue : undefined;
}
// Same strict, lossless projection as sandbox; production keeps an independent release package.
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function normalizeReport(data, input) {
  const fail = issue => { throw Object.assign(fault(502, 'invalid-report-response'), { validationIssue: issue }); };
  const str = (value, max = 1000, issue = 'cell_value') => typeof value === 'string' && value.length <= max ? value : fail(issue);
  const header = data?.Header;
  if (!header || typeof header !== 'object' || Array.isArray(header)) fail('header_shape');
  if (header.ReportName !== input.report) fail('header_name');
  if (!/^[A-Z]{3}$/.test(header.Currency || '')) fail('header_currency');
  if (!validDate(header.EndPeriod) || header.EndPeriod !== input.endDate) fail('header_end_period');
  if (input.report === 'ProfitAndLoss' && header.StartPeriod !== input.startDate) fail('header_start_period');
  if (header.ReportBasis && header.ReportBasis !== input.basis) fail('header_basis');
  const sourceColumns = data.Columns?.Column;
  if (!Array.isArray(sourceColumns) || sourceColumns.length < 1 || sourceColumns.length > 24) fail('columns');
  const columns = sourceColumns.map(column => {
    if (!column || typeof column !== 'object' || Array.isArray(column) || column.Columns) fail('column_shape');
    return { title: str(column.ColTitle ?? '', 1000, 'column_title'), type: str(column.ColType, 80, 'column_type') };
  });
  const rows = [];
  const append = (cells, kind, depth) => {
    if (!Array.isArray(cells) || cells.length !== columns.length) fail('cell_count');
    if (rows.length >= 2000) fail('row_limit');
    rows.push({ kind, depth, values: cells.map(cell => str(cell?.value)) });
  };
  const walk = (container, depth) => {
    if (depth > 12) fail('row_depth');
    if (!container || !Array.isArray(container.Row)) fail('rows_shape');
    for (const row of container.Row) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) fail('row_shape');
      // Intuit's A/P example omits type on leaf and summary rows; validate their full shape.
      const type = row.type ?? (row.ColData ? 'Data' : 'Section');
      if (!['Section', 'Data'].includes(type)) fail('row_type');
      if (type === 'Data') {
        if (row.Header || row.Summary || row.Rows) fail('row_shape');
        append(row.ColData, 'data', depth);
      } else {
        if (row.ColData || (!row.Header && !row.Summary && !row.Rows)) fail('row_shape');
        if (row.Header) append(row.Header.ColData, 'heading', depth);
        if (row.Rows) walk(row.Rows, depth + 1);
        if (row.Summary) append(row.Summary.ColData, 'total', depth);
      }
    }
  };
  const options = header.Option ?? [];
  if (!Array.isArray(options) || options.some(option => !option || typeof option !== 'object' || Array.isArray(option))) fail('header_options');
  const empty = options.find(option => option.Name === 'NoReportData')?.Value;
  if (empty !== undefined && !['true', 'false'].includes(empty)) fail('no_report_data');
  if (data.Rows?.Row) walk(data.Rows, 0);
  else if (empty !== 'true') fail('missing_rows');
  if (rows.length === 0 && empty !== 'true') fail('empty_rows');
  return { name: input.report, currency: header.Currency, basis: header.ReportBasis ? str(header.ReportBasis, 20, 'header_basis') : null,
    startPeriod: validDate(header.StartPeriod) ? header.StartPeriod : null, endPeriod: header.EndPeriod,
    generatedAt: header.Time ? str(header.Time, 80, 'header_time') : null, noData: empty === 'true', columns, rows };
}

module.exports = { validDate, normalizeReport, reportValidationIssue, VALIDATION_ISSUES };
