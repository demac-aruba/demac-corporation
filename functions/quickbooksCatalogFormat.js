'use strict';
const { fault } = require('./quickbooksConnectionService');
const ENTITIES = new Set(['Customer', 'Item', 'Account']);
const PAGE_SIZE = 100;
function catalogInput(body) {
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['entity', 'startPosition'].includes(key)) ||
    !ENTITIES.has(body.entity) || !Number.isSafeInteger(body.startPosition) || body.startPosition < 1 ||
    body.startPosition > 99901 || (body.startPosition - 1) % PAGE_SIZE !== 0) throw fault(400, 'invalid-catalog-request');
  return { entity: body.entity, startPosition: body.startPosition };
}
function catalogUrl(realm, input) {
  const url = new URL(`https://quickbooks.api.intuit.com/v3/company/${realm}/query`);
  url.searchParams.set('query', `SELECT * FROM ${input.entity} WHERE Active IN (true, false) ORDERBY Id STARTPOSITION ${input.startPosition} MAXRESULTS ${PAGE_SIZE}`);
  return url;
}
function normalizeCatalog(data, input) {
  const invalid = () => { throw fault(502, 'invalid-catalog-response'); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value, required = false, max = 1000) => {
    if (value == null && !required) return null;
    if (typeof value !== 'string' || (required && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
    return value;
  };
  const ref = value => value == null ? null : object(value) ? text(value.value, true, 128) : invalid();
  if (!object(data) || data.Fault || !object(data.QueryResponse)) return invalid();
  const query = data.QueryResponse;
  if (Object.keys(query).some(key => ![input.entity, 'startPosition', 'maxResults', 'totalCount'].includes(key))) return invalid();
  const rows = query[input.entity] === undefined ? [] : query[input.entity];
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE ||
    (rows.length && (query.startPosition !== input.startPosition || query.maxResults !== rows.length)) ||
    (!rows.length && ((query.startPosition !== undefined && query.startPosition !== input.startPosition) || (query.maxResults !== undefined && query.maxResults !== 0))) ||
    (query.totalCount !== undefined && (!Number.isSafeInteger(query.totalCount) || query.totalCount < rows.length))) return invalid();
  const ids = new Set();
  const records = rows.map(row => {
    if (!object(row)) return invalid();
    const id = text(row.Id, true, 128);
    if (ids.has(id) || typeof row.Active !== 'boolean') return invalid();
    ids.add(id);
    const common = { id, name: text(input.entity === 'Customer' ? row.DisplayName : row.Name, true), active: row.Active };
    if (input.entity === 'Customer') return { ...common, company: text(row.CompanyName),
      email: row.PrimaryEmailAddr == null ? null : object(row.PrimaryEmailAddr) ? text(row.PrimaryEmailAddr.Address) : invalid(),
      currency: ref(row.CurrencyRef), parentId: ref(row.ParentRef),
      isJob: row.Job == null ? null : typeof row.Job === 'boolean' ? row.Job : invalid() };
    if (input.entity === 'Item') return { ...common, type: text(row.Type, true, 64), sku: text(row.Sku),
      incomeAccountId: ref(row.IncomeAccountRef), expenseAccountId: ref(row.ExpenseAccountRef), assetAccountId: ref(row.AssetAccountRef) };
    return { ...common, type: text(row.AccountType, true, 64), subType: text(row.AccountSubType), currency: ref(row.CurrencyRef) };
  });
  // A full page never proves completeness. At the bound, explicitly report truncation.
  const full = records.length === PAGE_SIZE;
  return { records, pageSize: PAGE_SIZE, nextStartPosition: full && input.startPosition < 99901 ? input.startPosition + PAGE_SIZE : null,
    atLimit: full && input.startPosition === 99901, endOfCurrentQuery: !full };
}
module.exports = { catalogInput, catalogUrl, normalizeCatalog, PAGE_SIZE };
