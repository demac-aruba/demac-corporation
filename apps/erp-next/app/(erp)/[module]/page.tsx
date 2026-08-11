type ModuleCopy = {
  code: string;
  title: string;
  description: string;
  foundations: [string, string][];
};

const moduleCopy: Record<string, ModuleCopy> = {
  kpis: { code: 'KPI', title: 'KPI Intelligence Center', description: 'Progressive company metrics with pace versus elapsed time, targets, forecasts, drill-down and management alerts.', foundations: [['Progressive Metrics', 'Sales, cash, jobs, expenses and profitability versus target and time.'], ['Forecasting', 'Month-end projections and exception alerts instead of static historical reporting.'], ['Drill-down', 'Every KPI opens the operating facts behind the number.']] },
  technicians: { code: 'FLD', title: 'Field Operations', description: 'Technician-first job execution with equipment history, checklists, photos, readings, voice, parts, add-ons and concise AI reports.', foundations: [['Fast Field UX', 'Structured without becoming slow or repetitive.'], ['Offline Ready', 'Capture safely when connectivity is weak.'], ['Evidence Preserved', 'Original technical inputs stay available alongside professionalized output.']] },
  leads: { code: 'LE', title: 'Lead Management', description: 'Capture, qualify, assign and measure every new demand source before it becomes a customer opportunity.', foundations: [['Source Attribution', 'WhatsApp, phone, social, referral, website and technician opportunities.'], ['Ownership', 'Every qualified lead has an owner and next action.'], ['Conversion', 'Lead-to-booking and lead-to-profit become measurable.']] },
  opportunities: { code: 'OP', title: 'Opportunity Pipeline', description: 'Track residential replacements, commercial proposals, technician recommendations and large-project opportunities through a controlled sales pipeline.', foundations: [['Pipeline', 'Clear stages, expected value, probability and close date.'], ['Technician Pull-through', 'Field discoveries become trackable opportunities.'], ['Forecast', 'Expected revenue feeds management and cash projections.']] },
  estimates: { code: 'EST', title: 'Estimates & Proposals', description: 'Controlled pricing, versions, options, deposits, approvals and direct conversion to operational work without duplicate entry.', foundations: [['Pricebook Governance', 'Approved costs, sell prices, bundles and margin rules.'], ['Proposal Versions', 'Good/Better/Best and commercial scopes with audit history.'], ['Operational Handoff', 'Accepted scope becomes work, inventory demand and scheduling input.']] },
  maintenance: { code: 'PM', title: 'Maintenance & Agreements', description: 'Recurring service obligations connected to customers, sites and individual HVAC assets.', foundations: [['Recurring Work', 'Generate due maintenance without losing asset-level history.'], ['Renewals', 'Surface renewal windows and contract profitability.'], ['Retention', 'Detect customers drifting beyond their normal service cycle.']] },
  vans: { code: 'VAN', title: 'Van Stock & Readiness', description: 'Operational control of van inventory, custodian responsibility, replenishment and job-level material readiness.', foundations: [['Par Levels', 'Different service, installation and commercial van templates.'], ['Variance', 'Cycle counts and discrepancy reasons by van.'], ['Job Check', 'Missing material is surfaced before departure.']] },
  tools: { code: 'TLS', title: 'Tools & Company Assets', description: 'Custody, condition, calibration, repair and replacement control for tools that belong to DEMAC rather than sellable inventory.', foundations: [['Asset Identity', 'Tool ID, serial, condition and replacement value.'], ['Custody', 'Assigned to van and responsible technician/team.'], ['Quality', 'Inspection and calibration alerts where required.']] },
  invoices: { code: 'AR', title: 'Invoices & Receivables', description: 'Customer-level and invoice-level balances with partial payments, aging, collection workflow and supporting documentation.', foundations: [['Customer Balance', 'A payment received does not imply all invoices are settled.'], ['Aging', 'Current, overdue and disputed balances remain visible.'], ['Evidence', 'Invoice, work and payment history are linked.']] },
  expenses: { code: 'EXP', title: 'Expenses & Budgets', description: 'Voice and document-assisted purchase capture that can classify expenses, receive inventory, retain evidence and update budget pace.', foundations: [['Voice + Image', 'Explain the purchase, then verify it against the supplier invoice.'], ['Item Master', 'AI recognizes controlled DEMAC classifications instead of inventing accounts.'], ['Long-term Evidence', 'Original receipt, transcription, bank link and audit history remain connected.']] },
  employees: { code: 'HR', title: 'Employees & Workforce', description: 'Employee records, schedules, attendance, overtime, leave, skills, certifications and performance with appropriate privacy boundaries.', foundations: [['Role & Skills', 'Dispatch can use real competency information.'], ['Time', 'Operational time becomes structured workforce data.'], ['Privacy', 'Employees see their own data; sensitive payroll remains restricted.']] },
  projects: { code: 'PRJ', title: 'Projects & Commercial HVAC', description: 'Large installations, VRF projects, procurement, labor plans, changes, commissioning and margin forecasting.', foundations: [['WBS', 'Engineering through commissioning and handover.'], ['Cost Control', 'Budget, committed, actual and forecast at completion.'], ['Asset Handover', 'Installed project equipment becomes long-term service history.']] },
  reports: { code: 'RPT', title: 'Reports & Intelligence', description: 'Role-specific reporting with drill-down, traceable facts and exportable operational, financial and quality views.', foundations: [['Traceability', 'Reports reconcile to source transactions.'], ['Role Views', 'Owner, operations, warehouse, finance and projects see different priorities.'], ['Exceptions', 'Reports surface problems rather than requiring manual hunting.']] },
  'executive-ai': { code: 'EAI', title: 'DEMAC Executive AI', description: 'Owner-only conversational intelligence over controlled ERP tools, financial forecasts, KPIs and company knowledge.', foundations: [['Read First', 'Initial authority is analyze and explain, not write.'], ['Evidence', 'Answers show the operational facts and calculations used.'], ['Approval Actions', 'Later phases may prepare controlled actions for explicit approval.']] },
  settings: { code: 'SET', title: 'System Settings', description: 'A governed configuration layer for durations, schedules, sectors, price rules, thresholds, notifications and operational policies.', foundations: [['Configuration', 'Business rules live in settings when they are meant to change.'], ['Protected Rules', 'Integrity and audit requirements cannot be casually disabled.'], ['History', 'Sensitive configuration changes remain auditable.']] },
  automations: { code: 'AUT', title: 'Automation Center', description: 'Visible, governed automation rules with triggers, conditions, actions, owners and failure handling.', foundations: [['Deterministic Rules', 'Critical workflow logic stays testable.'], ['AI Assist', 'AI can classify and recommend around governed rules.'], ['Exception Queue', 'Failed automations become actionable, not invisible.']] },
  integrations: { code: 'INT', title: 'Integrations', description: 'Controlled connections to WhatsApp, telephony, QuickBooks, bank readers, maps, OpenAI, suppliers and future external systems.', foundations: [['Adapter Layer', 'External providers do not leak into core business logic.'], ['Health', 'Sync status and failures remain visible.'], ['Secrets', 'Credentials never live in client code or product documentation.']] },
  audit: { code: 'AUD', title: 'Audit Log', description: 'Immutable business-event history for sensitive changes in appointments, payments, inventory, permissions and other controlled records.', foundations: [['Who', 'Every significant action identifies the actor.'], ['What & When', 'Before/after context and timestamps support investigation.'], ['Governance', 'Critical evidence is not silently overwritten.']] },
};

export function generateStaticParams() {
  return Object.keys(moduleCopy).map((module) => ({ module }));
}

export const dynamicParams = false;

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const copy = moduleCopy[module];

  return (
    <section className="module-hero">
      <article className="module-placeholder">
        <div className="module-code">{copy.code}</div>
        <div className="eyebrow" style={{ marginTop: 22 }}>ERP Next Foundation</div>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <div className="foundation-list">
          {copy.foundations.map(([title, description]) => (
            <div className="foundation-item" key={title}><strong>{title}</strong><span>{description}</span></div>
          ))}
        </div>
      </article>
    </section>
  );
}
