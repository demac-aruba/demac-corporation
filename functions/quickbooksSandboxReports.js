'use strict';

// The only accounting calls in this module are GETs to three fixed sandbox report paths.
const crypto = require('node:crypto');
const { fault, hash, sealTokens, validateConfig } = require('./quickbooksSandboxService');
const REPORTS = new Set(['ProfitAndLoss', 'BalanceSheet', 'AgedReceivables']);
const LEASE_MS = 90000; // Longer than the 60-second Function invocation limit.
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function reportInput(body) {
  if (!body || Object.keys(body).some(key => !['action', 'report', 'startDate', 'endDate', 'basis'].includes(key)) ||
    !REPORTS.has(body.report) || !validDate(body.startDate) || !validDate(body.endDate) ||
    body.startDate > body.endDate || Date.parse(body.endDate) - Date.parse(body.startDate) > 365 * 86400000 ||
    !['Cash', 'Accrual'].includes(body.basis) || (body.report === 'AgedReceivables' && body.basis !== 'Accrual')) {
    throw fault(400, 'invalid-report-request');
  }
  return { report: body.report, startDate: body.startDate, endDate: body.endDate, basis: body.basis };
}
function openTokens(envelope, config) {
  try {
    if (envelope?.version !== 1 || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 100000) throw Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`quickbooks:sandbox:${config.realmId}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    if (![value.accessToken, value.refreshToken].every(token => typeof token === 'string' && token.length > 0 && token.length <= 16384) ||
      !Number.isFinite(value.accessExpiresAt)) throw Error();
    return value;
  } catch { throw fault(409, 'reauthorization-required'); }
}

// Consume a bounded response stream; never buffer an unbounded provider body or return its errors.
async function providerJson(fetchImpl, url, options, limit) {
  let response;
  try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { throw fault(502, 'provider-unavailable'); }
  if (!response.ok) {
    if (response.body) await response.body.cancel().catch(() => {});
    throw fault(response.status === 429 ? 429 : 502,
      response.status === 401 ? 'reauthorization-required' : response.status === 429 ? 'provider-rate-limited' : 'provider-unavailable');
  }
  try {
    const reader = response.body.getReader(); let size = 0; const parts = [];
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw fault(502, 'report-too-large'); }
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) { throw error.safeCode ? error : fault(502, 'invalid-provider-response'); }
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
      if (!row || !['Section', 'Data'].includes(row.type)) fail();
      if (row.type === 'Data') {
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

function createSandboxReports({ db, config, requireAdmin, fetchImpl = fetch, now = Date.now }) {
  const ref = db.collection('integrationPrivate').doc('quickbooksSandbox');
  const digest = record => hash(JSON.stringify(record.credentials));
  const configId = hash(JSON.stringify([config.realmId, config.clientId, config.redirectUri, config.encryptionKey]));
  async function report(uid, body) {
    validateConfig(config);
    const input = reportInput(body);
    const id = crypto.randomBytes(24).toString('hex');
    let lease;
    const record = await db.runTransaction(async tx => {
      await requireAdmin(uid, tx);
      const current = (await tx.get(ref)).data();
      if (!current?.credentials || current.connection?.realmId !== config.realmId) throw fault(409, 'sandbox-not-connected');
      if (current.reportOperation?.expiresAt > now() ||
        (current.attempt?.expiresAt > now() && ['started', 'exchanging', 'awaiting-finish'].includes(current.attempt.status))) throw fault(409, 'report-busy');
      if (current.reauthorizationRequired || current.reportOperation?.refreshing ||
        (current.credentialConfigId && current.credentialConfigId !== configId)) throw fault(409, 'reauthorization-required');
      if (current.lastReportAttemptAt > now() - 5000) throw fault(429, 'report-rate-limited');
      lease = { id, expiresAt: now() + LEASE_MS, credentialDigest: digest(current), refreshing: false };
      tx.set(ref, { ...current, reportOperation: lease, lastReportAttemptAt: now() });
      return current;
    });
    let mustReconnect = false;
    try {
      let tokens = openTokens(record.credentials, config);
      if (tokens.accessExpiresAt <= now() + 60000) {
        // Persist the uncertainty marker BEFORE contacting the token server. A timeout or
        // killed invocation must never blindly replay a possibly consumed refresh token.
        await db.runTransaction(async tx => {
          await requireAdmin(uid, tx);
          const current = (await tx.get(ref)).data();
          if (current?.reportOperation?.id !== id || digest(current) !== lease.credentialDigest || lease.expiresAt <= now()) throw fault(409, 'report-busy');
          tx.set(ref, { ...current, reportOperation: { ...lease, refreshing: true } });
        });
        mustReconnect = true;
        const issuedAt = now();
        const renewed = await providerJson(fetchImpl, TOKEN_URL, { method: 'POST', headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
        }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }).toString() }, 65536);
        if (![renewed.access_token, renewed.refresh_token].every(token => typeof token === 'string' && token.length > 0 && token.length <= 16384) ||
          String(renewed.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(renewed.expires_in) ||
          renewed.expires_in <= 60 || renewed.expires_in > 86400) throw fault(502, 'invalid-provider-response');
        tokens = { accessToken: renewed.access_token, refreshToken: renewed.refresh_token, accessExpiresAt: issuedAt + renewed.expires_in * 1000 };
        const credentials = sealTokens(tokens, config.encryptionKey, config.realmId);
        await db.runTransaction(async tx => {
          // Persist a rotated token even if the actor was revoked during the exchange;
          // fresh authorization below prevents delivering data to that actor.
          const current = (await tx.get(ref)).data();
          if (current?.reportOperation?.id !== id || digest(current) !== lease.credentialDigest || lease.expiresAt <= now()) throw fault(409, 'report-busy');
          const nextLease = { ...lease, credentialDigest: hash(JSON.stringify(credentials)), refreshing: false };
          tx.set(ref, { ...current, credentials, credentialConfigId: configId, reportOperation: nextLease });
        });
        lease = { ...lease, credentialDigest: hash(JSON.stringify(credentials)), refreshing: false };
        mustReconnect = false;
      }
      await requireAdmin(uid);
      const url = new URL(`https://sandbox-quickbooks.api.intuit.com/v3/company/${config.realmId}/reports/${input.report}`);
      if (input.report === 'AgedReceivables') {
        url.searchParams.set('report_date', input.endDate);
      } else {
        url.searchParams.set('end_date', input.endDate);
        url.searchParams.set('accounting_method', input.basis);
        if (input.report === 'ProfitAndLoss') url.searchParams.set('start_date', input.startDate);
      }
      const result = normalizeReport(await providerJson(fetchImpl, url.toString(), {
        method: 'GET', headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
      }, 2 * 1024 * 1024), input);
      const fetchedAt = new Date(now()).toISOString();
      await db.runTransaction(async tx => {
        await requireAdmin(uid, tx);
        const current = (await tx.get(ref)).data();
        if (current?.reportOperation?.id !== id || digest(current) !== lease.credentialDigest || lease.expiresAt <= now()) throw fault(409, 'report-busy');
        tx.set(ref, { ...current, reportOperation: null });
        tx.create(ref.collection('audit').doc(`${id}-report`), { actorId: uid, action: 'sandbox-report-read',
          target: `sandbox:${config.realmId}`, report: input.report, startDate: input.report === 'ProfitAndLoss' ? input.startDate : null,
          endDate: input.endDate, outcome: 'read-only', at: fetchedAt });
      });
      return { environment: 'sandbox', syncEnabled: false, realmId: config.realmId, companyName: record.connection.companyName,
        fetchedAt, request: input, report: result };
    } catch (error) {
      if (error.safeCode === 'reauthorization-required') mustReconnect = true;
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (current?.reportOperation?.id !== id) return; // A newer connection is never overwritten.
        tx.set(ref, { ...current, reportOperation: null, reauthorizationRequired: mustReconnect || !!current.reauthorizationRequired });
      });
      throw mustReconnect ? fault(409, 'reauthorization-required') : error;
    }
  }
  return { report };
}

module.exports = { createSandboxReports, normalizeReport, reportInput, openTokens };
