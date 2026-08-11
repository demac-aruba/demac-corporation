import { projects } from '@/lib/management-operations';

export default function ProjectsPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div><div className="eyebrow">Commercial & Project Operations</div><h1>Projects</h1><p>Large installations, VRF work, assessments and commercial corrective scopes with milestone, cost, procurement and margin visibility.</p></div>
        <div className="page-actions"><button className="btn" type="button">Portfolio View</button><button className="btn primary" type="button">+ New Project</button></div>
      </section>

      <section className="mo-metric-grid">
        <article><span>Active Projects</span><strong>3</strong><small>Afl. 176.5K combined budget</small></article>
        <article><span>Committed Cost</span><strong>Afl. 87.7K</strong><small>Across approved commitments</small></article>
        <article><span>Forecast Margin</span><strong>31.0%</strong><small className="mo-good">Portfolio weighted</small></article>
        <article><span>At Risk</span><strong>1</strong><small className="mo-warn">Cost forecast above budget</small></article>
      </section>

      <section className="mo-project-grid">
        {projects.map((project) => (
          <article className="panel mo-project-card" key={project.code}>
            <div className="mo-project-head"><div><span>{project.code}</span><h2>{project.name}</h2><p>{project.client} · {project.type}</p></div><b className={project.health === 'At Risk' ? 'mo-health risk' : 'mo-health'}>{project.health}</b></div>
            <div className="mo-project-progress"><div><span>Project progress</span><strong>{project.progress}%</strong></div><div className="mo-bar"><i style={{ width: `${project.progress}%` }} /></div></div>
            <div className="mo-project-finance"><div><span>Budget</span><strong>{project.budget}</strong></div><div><span>Committed</span><strong>{project.committed}</strong></div><div><span>Forecast</span><strong>{project.forecast}</strong></div><div><span>Margin</span><strong>{project.margin}</strong></div></div>
            <div className="mo-project-foot"><div><span>Stage</span><strong>{project.stage}</strong></div><div><span>Next milestone</span><strong>{project.nextMilestone}</strong></div></div>
          </article>
        ))}
      </section>

      <section className="mo-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Project Control Model</h2><span>What every commercial job will reconcile</span></div></header><div className="mo-rule-list"><div><strong>Scope & WBS</strong><span>Engineering → procurement → installation → testing → commissioning → handover</span></div><div><strong>Financial control</strong><span>Budget → committed → actual → forecast at completion</span></div><div><strong>Inventory</strong><span>Project reservations and receiving remain linked to the project</span></div><div><strong>Handover</strong><span>Installed equipment becomes CRM asset history for future service</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Portfolio Attention</h2><span>Exception-first management</span></div></header><div className="mo-callouts"><div className="warning"><strong>On The Rocks forecast over budget</strong><p>Current Afl. 17.2K forecast exceeds the Afl. 16.5K working budget. Review remaining corrective scope before commitment.</p></div><div><strong>VRF procurement milestone</strong><p>Equipment receiving is the next gating milestone. Job readiness should remain blocked until serialized equipment is received and inspected.</p></div></div></article>
      </section>
    </div>
  );
}
