# DEMAC ERP Next — Greenfield Architecture

Status: Foundation proposal implemented in code on `agent/erp-next-greenfield-foundation`.

## 1. Product boundary

ERP Next is a new application, not a visual reskin of Legacy.

- Legacy remains available as a reference and operational fallback.
- New product features are implemented in ERP Next unless a critical Legacy repair is required.
- Existing business rules may be reused only after they are expressed as explicit requirements and acceptance tests.
- Patch chains from Legacy are not copied into ERP Next.

## 2. Product surfaces

### ERP Web
Desktop-first management application for Owner, Operations, Office, Finance, Warehouse, Sales and Projects.

### Field App
Technician-focused execution experience. It can later remain PWA/native, but consumes the same canonical backend services.

### Customer Portal
Future self-service surface for appointments, estimates, payments, reports and equipment history.

## 3. Architectural layers

### Presentation
- App shell and navigation
- Design system
- Role-specific views
- Forms and tables
- KPI and alert components
- Communication workspace

### Application services
- CRM
- Scheduling & Dispatch
- Work Orders
- Inventory
- Purchasing
- Finance operations
- Communications
- Projects
- Workforce
- KPI engine

### Domain
Canonical business entities and rules. UI and external integrations must not become the source of business truth.

### Integration adapters
- Firebase / data persistence
- QuickBooks Online
- WhatsApp Business Platform
- WhatsApp Calling
- SIP / PBX
- Aruba Bank read-only browser bridge and statement import
- OpenAI
- Maps / routing
- Email and future supplier systems

### Intelligence
AI is an interpretation and automation layer over governed ERP tools. Critical business truth remains deterministic and auditable.

## 4. Canonical entity backbone

Customer -> Contact -> Site -> Asset

Lead -> Opportunity -> Estimate -> Appointment -> Work Order

Work Order -> Assignment -> Labor / Materials / Evidence -> Review -> Invoice -> Payment

Inventory Item -> Inventory Location -> Inventory Transaction

Conversation -> Communication Case -> Appointment / Estimate / Payment issue / Escalation

Project -> Work Orders / Procurement / Milestones / Commissioning -> Assets

Every significant change can produce an Audit Event.

## 5. Design system principles

- Premium enterprise look, not a template-like admin panel.
- Light and dark modes are first-class and persistent per user.
- DEMAC blue is interaction/brand accent; green means healthy/success; amber/red mean attention.
- Strong hierarchy, generous spacing, restrained shadows and rounded surfaces.
- Consistent reusable patterns for KPIs, status, tables, forms, drawers, dialogs and timelines.
- Desktop is optimized for dense operational work; mobile remains intentionally simplified.

## 6. Navigation model

Operations
- Command Center
- KPIs
- Scheduling & Dispatch
- Work Orders
- Technicians

Customers
- CRM
- Leads
- Opportunities
- Estimates
- Maintenance

Communications
- Communication Center
- AI Customer Agent
- Escalations

Inventory
- Warehouse
- Vans
- Purchasing
- Tools

Finance
- Finance Center
- Invoices
- Payments
- Banking Monitor
- Expenses & Budgets

Management
- Employees
- Projects
- Reports
- Executive AI

System
- Settings
- Automations
- Integrations
- Audit Log

## 7. Permissions

Initial canonical roles:
- Super Admin
- Operations
- Office Operator
- Finance
- Warehouse
- Sales
- Project Manager
- Technician
- Auditor

Permissions must be enforced in service/data access, not only hidden in menus.

## 8. Configuration versus protected rules

Configurable examples:
- Job durations
- Business hours
- Sector mappings
- Par levels
- Reorder thresholds
- Price rules
- Notification timing
- Approval thresholds

Protected examples:
- Auditability
- No duplicate customer communication for support assignments
- No employee assigned to incompatible simultaneous work
- Payment/inventory integrity
- Separation of financial permissions

## 9. AI authority model

Phase A: Read and analyze.
Phase B: Prepare draft actions.
Phase C: Execute low-risk actions after explicit approval.
Phase D: Selective autonomous workflows only after measured reliability.

The AI must use controlled tools rather than unrestricted production database access.

## 10. Data and migration posture

ERP Next will not change production Firebase schema during the foundation phase.

Before migration:
1. Inventory Legacy collections and data quality.
2. Map Legacy entities to canonical ERP Next entities.
3. Define migration transforms and idempotency.
4. Run dry migrations in a non-production environment.
5. Reconcile record counts and critical financial/operational totals.
6. Perform user acceptance testing.
7. Plan cutover and rollback.

## 11. Technical foundation

The management application starts as an isolated Next.js web app under `apps/erp-next`.

Current foundation target:
- Next.js 16.2 Active LTS security line
- React 19.2 stable line
- TypeScript strict mode
- CSS design tokens without dependency on a third-party visual template

This app can be deployed as a separate Vercel project/root while Legacy remains operational.

## 12. Definition of done for a module

A module is not complete because a screen exists. It requires:
- Approved requirements IDs
- Data model
- Permissions
- Business rules
- Error and exception behavior
- UI/UX
- Audit events where relevant
- Integration contract where relevant
- Automated tests
- User acceptance scenarios
- Production readiness checklist
