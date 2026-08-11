'use client';

import { useMemo, useState } from 'react';
import { executiveScenarios } from '@/lib/management-intelligence';

export function ExecutiveAiWorkspace() {
  const [activeId, setActiveId] = useState(executiveScenarios[0].id);
  const [draft, setDraft] = useState('');
  const scenario = useMemo(() => executiveScenarios.find((item) => item.id === activeId) ?? executiveScenarios[0], [activeId]);

  const submit = () => {
    const normalized = draft.trim().toLowerCase();
    if (!normalized) return;
    if (normalized.includes('attention') || normalized.includes('today') || normalized.includes('hoy')) setActiveId('operations-risk');
    else if (normalized.includes('sales') || normalized.includes('venta') || normalized.includes('goal') || normalized.includes('meta')) setActiveId('sales-health');
    else setActiveId('cash-180');
    setDraft('');
  };

  return (
    <div className="mi-stack">
      <section className="page-head mi-head">
        <div>
          <div className="eyebrow">Owner Intelligence · Controlled Preview</div>
          <h1>DEMAC Executive AI</h1>
          <p>ERP calculations remain the source of financial and operational truth. The AI explains, compares, forecasts and recommends — with visible evidence, freshness and authority boundaries.</p>
        </div>
        <div className="mi-ai-status"><span className="mi-live-dot" /><div><strong>Read & Analyze</strong><small>Write actions require approval</small></div></div>
      </section>

      <section className="mi-ai-layout">
        <aside className="panel mi-ai-presets">
          <header className="panel-head"><div><h2>Decision Prompts</h2><span>Examples from management workflows</span></div></header>
          <div className="mi-preset-list">
            {executiveScenarios.map((item) => (
              <button className={activeId === item.id ? 'active' : ''} type="button" onClick={() => setActiveId(item.id)} key={item.id}>
                <span>Ask</span><strong>{item.question}</strong>
              </button>
            ))}
          </div>
          <div className="mi-authority-box">
            <span>Authority boundary</span>
            <strong>Analyze → Prepare → Human approval</strong>
            <p>No bank transfer, refund, journal entry, payroll change, deletion or large purchase can be executed autonomously.</p>
          </div>
        </aside>

        <main className="panel mi-ai-main">
          <div className="mi-ai-conversation">
            <div className="mi-user-question"><span>Christian</span><p>{scenario.question}</p></div>
            <div className="mi-ai-answer">
              <div className="mi-ai-answer-head"><div><span>DEMAC Executive AI</span><strong>{scenario.confidence} confidence</strong></div><time>Evidence refreshed now</time></div>
              <p className="mi-ai-primary-answer">{scenario.answer}</p>
              <div className="mi-recommendation"><span>Recommended action</span><p>{scenario.recommendation}</p></div>
            </div>
          </div>

          <div className="mi-evidence-section">
            <div className="mi-section-title"><div><strong>Evidence used</strong><span>Every answer is traceable to ERP facts</span></div><button type="button">Open source transactions</button></div>
            <div className="mi-evidence-grid">
              {scenario.evidence.map((item) => (
                <article className="mi-evidence-card" key={item.label}>
                  <span>{item.label}</span><strong>{item.value}</strong><p>{item.detail}</p><time>{item.freshness}</time>
                </article>
              ))}
            </div>
          </div>

          <div className="mi-risk-section">
            <strong>Risks & assumptions</strong>
            <div>{scenario.risks.map((risk) => <p key={risk}><span>!</span>{risk}</p>)}</div>
          </div>

          <div className="mi-ai-composer">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} placeholder="Ask about cash, sales, operations, customers, inventory or projects..." aria-label="Ask DEMAC Executive AI" />
            <button type="button" onClick={submit}>Analyze</button>
          </div>
        </main>

        <aside className="panel mi-ai-context">
          <header className="panel-head"><div><h2>Company Context</h2><span>Current management snapshot</span></div></header>
          <div className="mi-context-stat"><span>Cash</span><strong>Afl. 144K</strong><small>Read-only evidence</small></div>
          <div className="mi-context-stat"><span>Receivables</span><strong>Afl. 37.6K</strong><small>Afl. 12.1K overdue</small></div>
          <div className="mi-context-stat"><span>Sales Pace</span><strong className="mi-positive">+37 pts</strong><small>Ahead of elapsed month</small></div>
          <div className="mi-context-stat"><span>Expense Pace</span><strong className="mi-negative">+46 pts</strong><small>Ahead of desired spend pace</small></div>
          <div className="mi-context-stat"><span>Open Alerts</span><strong>5</strong><small>1 critical · 2 warning</small></div>
          <div className="mi-data-quality"><span>Data quality</span><strong>Preview / structured demo data</strong><p>Live tool adapters will replace these preview facts when Firebase, QuickBooks, banking and other integrations are connected.</p></div>
        </aside>
      </section>
    </div>
  );
}
