import { opportunities } from '@/lib/revenue-cycle';

export default function OpportunitiesPage() {
  const weighted = 'Afl. 87.7K';
  return <div className="rc-stack">
    <section className="page-head"><div><div className="eyebrow">CRM · Commercial Pipeline</div><h1>Opportunities</h1><p>Residential replacements, technician recommendations and commercial proposals remain visible with value, probability, expected close and next action.</p></div><div className="page-actions"><button className="btn" type="button">Forecast</button><button className="btn primary" type="button">+ Opportunity</button></div></section>
    <section className="rc-metrics"><article><span>Open Pipeline</span><strong>Afl. 146K</strong><small>4 preview opportunities</small></article><article><span>Weighted Forecast</span><strong>{weighted}</strong><small>Probability-adjusted</small></article><article><span>Next 30 Days</span><strong>Afl. 28.4K</strong><small className="rc-good">Likely near-term close</small></article><article><span>Field Recommendations</span><strong>6</strong><small>Awaiting follow-up</small></article></section>
    <section className="rc-opportunity-grid">{opportunities.map(op=><article className="panel rc-op-card" key={op.name}><div className="rc-op-head"><div><span>{op.stage}</span><h2>{op.name}</h2><p>{op.customer}</p></div><strong>{op.value}</strong></div><div className="rc-probability"><div><span>Probability</span><b>{op.probability}%</b></div><div className="rc-bar"><i style={{width:`${op.probability}%`}}/></div></div><div className="rc-op-meta"><div><span>Expected close</span><strong>{op.close}</strong></div><div><span>Owner</span><strong>{op.owner}</strong></div></div><div className="rc-next-action"><span>Next action</span><strong>{op.next}</strong></div></article>)}</section>
    <section className="panel rc-pipeline"><header className="panel-head"><div><h2>Pipeline Stages</h2><span>Every opportunity must keep momentum and ownership</span></div></header><div><span>New</span><i/><span>Qualified</span><i/><span>Estimate Needed</span><i/><span>Proposal</span><i/><span>Negotiating</span><i/><span>Won / Lost</span></div></section>
  </div>;
}
