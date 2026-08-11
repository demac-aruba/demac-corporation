import { FirebaseAdapterStatus } from '@/components/firebase/firebase-adapter-status';
import { integrationHealth } from '@/lib/system-governance';

export default function IntegrationsPage() {
  const remainingIntegrations = integrationHealth.filter((integration) => integration.name !== 'Firebase');

  return (
    <div className="sg-stack">
      <section className="page-head"><div><div className="eyebrow">Adapter & Provider Layer</div><h1>Integrations</h1><p>External providers connect through governed adapters so Firebase, QuickBooks, Meta, OpenAI, banking and telephony do not leak provider-specific behavior into core ERP logic.</p></div><div className="page-actions"><button className="btn" type="button">Integration Logs</button><button className="btn primary" type="button">+ Connection</button></div></section>
      <section className="sg-integration-summary"><article><span>Registered</span><strong>{integrationHealth.length}</strong><small>Provider domains</small></article><article><span>Production Writes</span><strong>0</strong><small className="sg-good">Protected during rebuild</small></article><article><span>Firebase Adapter</span><strong>Ready</strong><small>REST/Auth contracts compiled</small></article><article><span>Console Changes</span><strong>0</strong><small>Rules/index changes deferred</small></article></section>
      <section className="sg-integration-grid">
        <FirebaseAdapterStatus />
        {remainingIntegrations.map((integration) => (
          <article className="panel sg-integration-card" key={integration.name}>
            <div className="sg-integration-head"><div className="sg-provider-mark">{integration.name.slice(0,2).toUpperCase()}</div><div><span>{integration.category}</span><h2>{integration.name}</h2></div><b className={integration.status === 'Design Ready' ? 'ready' : ''}>{integration.status}</b></div>
            <p>{integration.detail}</p>
            <div className="sg-integration-foot"><div><span>Environment</span><strong>{integration.environment}</strong></div><button type="button">Open configuration →</button></div>
          </article>
        ))}
      </section>
      <section className="panel sg-guardrail"><div><span>Secret-management rule</span><strong>Service-account keys, bank credentials, Soft Tokens and provider secrets never belong in browser code, screenshots, product docs or the Master Specification. Firebase web-app identifiers are public client configuration and are handled separately from secrets.</strong></div><b>Secrets server-side only</b></section>
    </div>
  );
}
