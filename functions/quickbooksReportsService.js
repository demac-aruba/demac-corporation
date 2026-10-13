'use strict';
const crypto = require('node:crypto');
const { fault, hash, seal, open, validateConfig } = require('./quickbooksConnectionService');
const { validDate, normalizeReport } = require('./quickbooksReportsFormat');
const REALM = '9130352327074466';
const REPORTS = new Set(['ProfitAndLoss', 'BalanceSheet', 'AgedReceivables', 'AgedPayables']);
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const LEASE_MS = 90000; // Longer than both functions' hard 60-second invocation limits.
function reportInput(body) {
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !['report', 'startDate', 'endDate', 'basis'].includes(key)) ||
    !REPORTS.has(body.report) || !validDate(body.startDate) || !validDate(body.endDate) || body.startDate > body.endDate ||
    Date.parse(body.endDate) - Date.parse(body.startDate) > 183 * 86400000 ||
    !['Cash', 'Accrual'].includes(body.basis) || (body.report.startsWith('Aged') && body.basis !== 'Accrual')) throw fault(400, 'invalid-report-request');
  return { report: body.report, startDate: body.startDate, endDate: body.endDate, basis: body.basis };
}
async function providerJson(fetchImpl, url, options, limit) {
  let response;
  try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { throw fault(502, 'provider-unavailable'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw fault(response.status === 429 ? 429 : 502, response.status === 401 ? 'reauthorization-required' :
      response.status === 429 ? 'provider-rate-limited' : 'provider-unavailable');
  }
  try {
    const reader = response.body.getReader(); const parts = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) { await reader.cancel(); throw fault(502, 'report-too-large'); }
      parts.push(Buffer.from(value)); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) { throw error.safeCode ? error : fault(502, 'invalid-provider-response'); }
}
function createReportsService({ db, config, requireOwner, fetchImpl = fetch, now = Date.now }) {
  const ref = db.collection('integrationPrivate').doc('quickbooksProduction');
  const configId = hash(JSON.stringify([config.realmId, config.ownerUid, config.clientId, config.clientSecret,
    config.encryptionKey, config.redirectUri, config.returnUrl]));
  const digest = record => hash(JSON.stringify(record.credentials || null));
  function checkConnected(record) {
    if (!record?.credentials || record.connection?.realmId !== REALM || record.configId !== configId || record.disconnect) throw fault(409, 'production-not-connected');
    if (record.attempt && record.attempt.status !== 'completed') throw fault(409, 'authorization-cleanup-required');
  }
  async function report(uid, body) {
    validateConfig(config);
    if (config.realmId !== REALM) throw fault(503, 'not-configured');
    const input = reportInput(body); const id = crypto.randomBytes(24).toString('hex'); let lease;
    const record = await db.runTransaction(async tx => {
      await requireOwner(uid, tx);
      const current = (await tx.get(ref)).data(); checkConnected(current);
      if (current.operation?.expiresAt > now()) throw fault(409, 'report-busy');
      if (current.reportRecoveryDigest === digest(current) || current.operation?.refreshing) throw fault(409, 'reauthorization-required');
      if (current.lastReportAttemptAt > now() - 5000) throw fault(429, 'report-rate-limited');
      lease = { id, kind: 'report', expiresAt: now() + LEASE_MS, credentialDigest: digest(current),
        connectionVersion: current.connection.version, refreshing: false };
      tx.set(ref, { ...current, operation: lease, lastReportAttemptAt: now() }); return current;
    });
    let recovery = false;
    function sameOperation(current) {
      checkConnected(current);
      if (current.operation?.id !== id || digest(current) !== lease.credentialDigest ||
        current.connection.version !== lease.connectionVersion || lease.expiresAt <= now()) throw fault(409, 'report-busy');
    }
    try {
      let tokens = open(record.credentials, config);
      if (typeof tokens.accessToken !== 'string' || !tokens.accessToken || tokens.accessToken.length > 16384 ||
        !Number.isFinite(tokens.accessExpiresAt)) throw fault(409, 'reauthorization-required');
      if (tokens.accessExpiresAt <= now() + 60000) {
        // Write uncertainty before contacting Intuit. A killed invocation cannot replay the token.
        await db.runTransaction(async tx => {
          await requireOwner(uid, tx); const current = (await tx.get(ref)).data(); sameOperation(current);
          tx.set(ref, { ...current, reportRecoveryDigest: lease.credentialDigest, operation: { ...lease, refreshing: true } });
        });
        recovery = true; const issuedAt = now();
        const renewed = await providerJson(fetchImpl, TOKEN, { method: 'POST', headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }).toString() }, 65536);
        if (![renewed.access_token, renewed.refresh_token].every(value => typeof value === 'string' && value.length > 0 && value.length <= 16384) ||
          String(renewed.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(renewed.expires_in) || renewed.expires_in <= 60 || renewed.expires_in > 86400) throw fault(502, 'invalid-provider-response');
        tokens = { accessToken: renewed.access_token, refreshToken: renewed.refresh_token, accessExpiresAt: issuedAt + renewed.expires_in * 1000 };
        const credentials = seal(tokens, config); const nextLease = { ...lease, credentialDigest: hash(JSON.stringify(credentials)) };
        await db.runTransaction(async tx => {
          // Preserve rotated credentials even if the actor lost access; reauthorize before reading data.
          const current = (await tx.get(ref)).data(); sameOperation(current);
          tx.set(ref, { ...current, credentials, operation: nextLease, reportRecoveryDigest: null });
        });
        lease = nextLease; recovery = false;
      }
      await requireOwner(uid);
      // No configurable host, tenant, path, query language or accounting mutation is accepted.
      const url = new URL(`https://quickbooks.api.intuit.com/v3/company/${REALM}/reports/${input.report}`);
      if (input.report.startsWith('Aged')) { url.searchParams.set('report_date', input.endDate); url.searchParams.set('aging_method', 'Report_Date'); }
      else {
        url.searchParams.set('end_date', input.endDate); url.searchParams.set('accounting_method', input.basis);
        if (input.report === 'ProfitAndLoss') url.searchParams.set('start_date', input.startDate);
      }
      const result = normalizeReport(await providerJson(fetchImpl, url.toString(), { method: 'GET',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' } }, 2 * 1024 * 1024), input);
      const fetchedAt = new Date(now()).toISOString();
      await db.runTransaction(async tx => {
        await requireOwner(uid, tx); const current = (await tx.get(ref)).data(); sameOperation(current);
        tx.set(ref, { ...current, operation: null });
        tx.create(ref.collection('audit').doc(`${id}-report`), { actorId: uid, action: 'production-report-read',
          report: input.report, startDate: input.report === 'ProfitAndLoss' ? input.startDate : null,
          endDate: input.endDate, basis: input.basis, outcome: 'read-only', at: fetchedAt });
      });
      return { environment: 'production', syncEnabled: false, accountingWritesEnabled: false, realmId: REALM,
        companyName: record.connection.companyName, fetchedAt, request: input, report: result };
    } catch (error) {
      if (['reauthorization-required', 'credential-recovery-required'].includes(error.safeCode)) recovery = true;
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data(); if (current?.operation?.id !== id) return;
        tx.set(ref, { ...current, operation: null, ...(recovery ? { reportRecoveryDigest: lease.credentialDigest } : {}) });
        tx.create(ref.collection('audit').doc(`${id}-report-failed`), { actorId: uid, action: 'production-report-failed',
          report: input.report, outcome: recovery ? 'reauthorization-required' : error.safeCode || 'report-failed', at: new Date(now()).toISOString() });
      });
      throw recovery ? fault(409, 'reauthorization-required') : error;
    }
  }
  return { report };
}
module.exports = { createReportsService, reportInput, REALM };
