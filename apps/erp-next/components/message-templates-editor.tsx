'use client';
import { useEffect, useRef, useState } from 'react';
import { CATALOG, FIELDS, LIMITS, defaultsFor, previewMessage, validateFields, type CopyFields, type MessageTemplateApi, type MessageTemplateRecord, type MessageTemplateHistory, type MessageTemplateSave } from '../lib/message-templates';
import styles from './message-templates-editor.module.css';

const languageNames: Record<string, string> = { en: 'English', es: 'Español', pap: 'Papiamento', nl: 'Nederlands' };
const fieldLabels = { greeting: 'Greeting', introduction: 'Introduction', closing: 'Closing paragraph' };
const keyOf = (id: string, language: string) => `${id}_${language}`;
const same = (a: CopyFields, b: CopyFields) => FIELDS.every(field => a[field] === b[field]);
const readableError = (error: unknown) => error instanceof Error ? error.message : 'Unable to load messages. Please try again.';
function FormattedText({ text }: { text: string }) {
  return <>{text.split(/(\*[^*\n]+\*)/g).map((part, i) => part.startsWith('*') && part.endsWith('*') ? <strong key={i}>{part.slice(1, -1)}</strong> : part)}</>;
}

export function MessageTemplatesEditor({ api, initialRecords }: { api: MessageTemplateApi; initialRecords?: MessageTemplateRecord[] }) {
  const [records, setRecords] = useState<Record<string, MessageTemplateRecord>>(() => Object.fromEntries((initialRecords || []).map(row => [keyOf(row.id, row.language), row])));
  const [drafts, setDrafts] = useState<Record<string, CopyFields>>({});
  const [selection, setSelection] = useState({ id: CATALOG[0].id, language: 'en' });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(!initialRecords);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<MessageTemplateSave | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<{ key: string; rows: MessageTemplateHistory[]; loading: boolean } | null>(null);
  const mounted = useRef(true);
  const flight = useRef(false);
  const focusedField = useRef<keyof CopyFields>('greeting');
  const inputs = useRef<Partial<Record<keyof CopyFields, HTMLTextAreaElement | null>>>({});
  const storageKey = `demac:message-template-save:v1:${api.ownerKey}`;
  const key = keyOf(selection.id, selection.language);
  const item = CATALOG.find(value => value.id === selection.id)!;
  const record = records[key];
  const fields = drafts[key] || record?.fields || defaultsFor(item.id, selection.language);
  const dirty = Boolean(record && !same(fields, record.fields));
  const dirtyCount = Object.entries(drafts).filter(([id, value]) => records[id] && !same(value, records[id].fields)).length;
  let preview = '', validationError = '';
  try { preview = previewMessage(item.id, selection.language, fields); } catch { validationError = 'Check the text length and use only the available placeholders.'; }
  const locked = loading || saving || Boolean(pending) || recoveryBlocked || !record;

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const request = JSON.parse(stored) as MessageTemplateSave;
        validateFields(request.id, request.language, request.fields);
        if (request.action !== 'save' || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || !/^[a-zA-Z0-9_-]{16,80}$/.test(request.requestId)) throw new Error('Unrecognized saved request.');
        setPending(request); setSelection({ id: request.id, language: request.language });
        setDrafts({ [keyOf(request.id, request.language)]: request.fields });
        setNotice('A previous save needs confirmation. Use Check save to verify it safely.');
      }
    } catch { setError('A previous save could not be read. Keep this page open and ask for technical help before editing.'); setRecoveryBlocked(true); }
    api.list().then(rows => {
      if (!cancelled) setRecords(Object.fromEntries(rows.map(row => [keyOf(row.id, row.language), row])));
    }).catch(cause => { if (!cancelled) setError(readableError(cause)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; mounted.current = false; };
  }, [api, storageKey]);

  useEffect(() => {
    if (!dirtyCount && !pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyCount, pending]);

  function edit(field: keyof CopyFields, value: string) {
    setDrafts(current => ({ ...current, [key]: { ...fields, [field]: value } })); setNotice('');
  }
  function insert(variable: string) {
    const field = focusedField.current, input = inputs.current[field];
    const start = input?.selectionStart ?? fields[field].length, end = input?.selectionEnd ?? start;
    const token = `{${variable}}`;
    edit(field, fields[field].slice(0, start) + token + fields[field].slice(end));
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); });
  }
  async function save() {
    if (flight.current || recoveryBlocked || (!pending && (!dirty || validationError || locked))) return;
    const request: MessageTemplateSave = pending || { action: 'save', ...selection, fields: validateFields(item.id, selection.language, fields), expectedRevision: record.revision, requestId: crypto.randomUUID() };
    flight.current = true; setSaving(true); setError(''); setNotice('');
    try {
      // Retain exact identity before dispatch; ambiguous responses reuse it.
      sessionStorage.setItem(storageKey, JSON.stringify(request)); setPending(request);
      const result = await api.save(request);
      if (!mounted.current) return;
      sessionStorage.removeItem(storageKey); setPending(null);
      setRecords(current => ({ ...current, [keyOf(request.id, request.language)]: result.record }));
      if (result.record.revision !== result.savedRevision) {
        setError('Your change was saved, then updated by someone else. Your draft is retained for comparison.');
      } else {
        setDrafts(current => { const next = { ...current }; delete next[keyOf(request.id, request.language)]; return next; });
        setNotice(api.mode === 'preview' ? 'Saved in this preview. Production messages are unchanged.' : 'Message saved. Newly created messages will use this version.');
      }
      setHistory(null);
    } catch (cause) {
      if (!mounted.current) return;
      const code = (cause as { code?: string })?.code;
      if (code && ['revision-conflict', 'invalid-variable', 'invalid-text', 'invalid-fields', 'invalid-request', 'empty-message'].includes(code)) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(readableError(cause));
    } finally { flight.current = false; if (mounted.current) setSaving(false); }
  }
  async function reload() {
    if (pending || saving || recoveryBlocked || (dirtyCount && !window.confirm('Reload saved messages and discard your unsaved drafts?'))) return;
    setLoading(true); setError(''); setNotice('');
    try { const rows = await api.list(); if (!mounted.current) return; setRecords(Object.fromEntries(rows.map(row => [keyOf(row.id, row.language), row]))); setDrafts({}); }
    catch (cause) { if (mounted.current) setError(readableError(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }
  async function openHistory() {
    const historyKey = key; setHistory({ key: historyKey, rows: [], loading: true }); setError('');
    try { const rows = await api.history(selection.id, selection.language); if (mounted.current) setHistory({ key: historyKey, rows, loading: false }); }
    catch (cause) { if (mounted.current) { setHistory(null); setError(readableError(cause)); } }
  }
  const visible = CATALOG.filter(value => `${value.label} ${value.description} ${value.group}`.toLowerCase().includes(query.toLowerCase()));
  return <div className={styles.workspace}>
    <header className={styles.pageHead}>
      <div><div className={styles.eyebrow}>SYSTEM / COMMUNICATIONS</div><h1>Message Templates</h1><p>Make every DEMAC message sound like you.</p></div>
      <div className={styles.headActions}><span className={styles.ownerBadge}>Administrator</span><button className={styles.secondary} disabled={saving || Boolean(pending) || loading} onClick={() => void reload()}>↻ Reload</button></div>
    </header>
    {api.mode === 'preview' ? <div className={styles.previewNotice}>Interactive preview · Example data · No messages are sent</div> : null}
    <div className={styles.layout}>
      <aside className={styles.catalog} aria-label="Message catalog">
        <div className={styles.catalogHead}><strong>All messages</strong><span>{CATALOG.length}</span></div>
        <label className={styles.search}><span className={styles.srOnly}>Search messages</span><input placeholder="Search messages…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {['Customers', 'Technicians', 'Tasks'].map(group => <section key={group} className={styles.group}><h2>{group}</h2>{visible.filter(value => value.group === group).map(value => <button key={value.id} className={`${styles.messageItem} ${item.id === value.id ? styles.selected : ''}`} aria-current={item.id === value.id ? 'page' : undefined} disabled={saving || Boolean(pending)} onClick={() => { setSelection({ id: value.id, language: value.languages.includes(selection.language) ? selection.language : value.languages[0] }); setHistory(null); setNotice(''); }}><span className={styles.messageIcon}>{value.group === 'Customers' ? '↗' : value.group === 'Technicians' ? '▤' : '✓'}</span><span>{value.label}</span>{Object.keys(drafts).some(draftKey => draftKey.startsWith(value.id + '_') && records[draftKey] && !same(drafts[draftKey], records[draftKey].fields)) ? <i aria-label="Unsaved changes" /> : null}</button>)}</section>)}
        {!visible.length ? <p className={styles.empty}>No matching messages.</p> : null}
        <p className={styles.catalogFoot}>New message types can be added to this same catalog as DEMAC grows.</p>
      </aside>
      <section className={styles.editor} aria-label="Message editor">
        <header className={styles.editorHead}><div><span className={styles.eyebrow}>{item.group}</span><h2>{item.label}</h2><p>{item.description}</p></div><span className={dirty ? styles.draftBadge : styles.savedBadge}>{dirty ? 'Unsaved changes' : record?.revision ? `Saved · v${record.revision}` : 'DEMAC default'}</span></header>
        <div className={styles.languageBar} role="group" aria-label="Message language">{item.languages.map(language => <button key={language} aria-pressed={language === selection.language} className={language === selection.language ? styles.activeLanguage : ''} disabled={saving || Boolean(pending)} onClick={() => { setSelection({ id: item.id, language }); setHistory(null); setNotice(''); }}>{languageNames[language]}</button>)}</div>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {loading ? <p className={styles.empty} role="status">Loading your saved messages…</p> : null}
        <div className={styles.fields}>
          {(['greeting', 'introduction'] as const).map(field => <label key={field} className={styles.field}><span>{fieldLabels[field]}<small>{fields[field].length}/{LIMITS[field]}</small></span><textarea ref={element => { inputs.current[field] = element; }} rows={field === 'greeting' ? 2 : 3} disabled={locked} maxLength={LIMITS[field]} value={fields[field]} placeholder={field === 'greeting' ? 'Add a friendly greeting…' : 'Add an introduction…'} onFocus={() => { focusedField.current = field; }} onChange={event => edit(field, event.target.value)} /></label>)}
          {item.sampleDetails[selection.language] ? <div className={styles.protected}><span>▣</span><div><strong>{item.group === 'Customers' ? 'Appointment details' : item.group === 'Technicians' ? 'Work and schedule details' : 'Task details'} · filled automatically</strong><p>{item.group === 'Customers' ? 'Date, time, address, apartment and service stay connected to the appointment.' : 'Operational details stay connected to the saved work or task.'}</p></div></div> : null}
          <label className={styles.field}><span>{fieldLabels.closing}<small>{fields.closing.length}/{LIMITS.closing}</small></span><textarea ref={element => { inputs.current.closing = element; }} rows={5} disabled={locked} maxLength={LIMITS.closing} value={fields.closing} placeholder="Add a helpful closing paragraph…" onFocus={() => { focusedField.current = 'closing'; }} onChange={event => edit('closing', event.target.value)} /></label>
          <div className={styles.placeholders}><strong>Personalize your text</strong><p>Click a placeholder to insert it where you are writing.</p><div>{item.variables.map(variable => <button key={variable} disabled={locked} onClick={() => insert(variable)}>{`{${variable}}`}</button>)}</div></div>
          {validationError ? <p className={styles.error} role="alert">{validationError}</p> : null}
        </div>
        <footer className={styles.editorFooter}><div className={styles.footerButtons}><button className={styles.secondary} disabled={locked} onClick={() => { setDrafts(current => ({ ...current, [key]: defaultsFor(item.id, selection.language) })); setNotice('Default text restored in your draft. Save to apply it.'); }}>Restore default</button><button className={styles.textButton} disabled={locked} onClick={() => void openHistory()}>Version history</button><button className={styles.primary} disabled={recoveryBlocked || saving || (!pending && (!dirty || Boolean(validationError) || locked))} onClick={() => void save()}>{saving ? 'Saving…' : pending ? 'Check save' : api.mode === 'preview' ? 'Save preview' : 'Save changes'}</button></div><p>{api.mode === 'preview' ? 'Changes stay in this preview.' : 'Changes apply to newly created messages. Existing queued or sent messages keep their original text.'}</p>{record?.updatedAt ? <small>Last saved by {record.updatedByName || 'Administrator'} · {new Date(record.updatedAt).toLocaleString()}</small> : null}</footer>
        {history?.key === key ? <section className={styles.history} aria-label="Version history"><header><h3>Version history</h3><button className={styles.textButton} onClick={() => setHistory(null)}>Close</button></header>{history.loading ? <p>Loading history…</p> : !history.rows.length ? <p>No changes yet. This message uses the DEMAC default.</p> : history.rows.map(row => <div key={row.revision}><span><strong>Version {row.revision}</strong><small>{row.updatedByName} · {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ''}</small></span><button className={styles.secondary} disabled={locked} onClick={() => { setDrafts(current => ({ ...current, [key]: row.fields })); setNotice(`Version ${row.revision} loaded into your draft. Review and save to apply it.`); setHistory(null); }}>Use this version</button></div>)}</section> : null}
      </section>
      <aside className={styles.preview} aria-label="Message preview"><header><div><span className={styles.eyebrow}>LIVE PREVIEW</span><h2>What they’ll receive</h2></div><span className={styles.exampleBadge}>Example</span></header><div className={styles.phone}><div className={styles.chatHeader}><span className={styles.avatar}>D</span><div><strong>DEMAC</strong><small>Professional Cooling Solutions</small></div><span>⋮</span></div><div className={styles.chatBody}><span className={styles.day}>TODAY</span><div className={styles.bubble}>{validationError ? <span>Correct the highlighted text to update the preview.</span> : <FormattedText text={preview} />}<small>8:30 AM <span>✓✓</span></small></div></div><div className={styles.chatBottom}>Message<span>＋</span></div></div><p className={styles.previewCaption}>Updates as you type. Example details only.</p><div className={styles.info}><strong>One message, the right language</strong><p>{item.group === 'Customers' ? 'Each customer receives the version matching their saved language preference.' : `These messages currently use ${languageNames[selection.language]}.`}</p></div></aside>
    </div>
  </div>;
}
