# ERP Next Foundation Checkpoint

## Built in this checkpoint

- Isolated Next.js management application under `apps/erp-next`.
- Premium DEMAC application shell with grouped left navigation.
- Persistent light/dark mode.
- Responsive desktop/mobile navigation foundation.
- Executive Command Center preview with progressive KPIs, van status, job timeline and exception alerts.
- Registered module surfaces for CRM, scheduling, work orders, communications, inventory, finance, projects, Executive AI and system governance.
- Canonical TypeScript domain contracts for core ERP entities.
- Role-aware navigation contract.
- Architecture, migration and product-governance documentation.
- Isolated CI for typecheck/build.

## Explicitly not changed

- Legacy runtime
- Current Firebase schema/rules
- Current Vercel production project
- WhatsApp production backend
- QuickBooks integration
- Existing technician production flow

## Next checkpoint

CRM Customer 360 foundation:
- customer/account identity
- contacts
- sites/properties
- assets/equipment
- customer timeline
- relationship/financial summary
- opportunities/recommendations
- reusable premium table, tabs, drawer and detail-layout primitives

## Questions intentionally deferred

These do not block foundation development and can be decided when the relevant module is implemented:
- final production/staging subdomain naming
- final Firebase project/environment strategy
- exact customer numbering convention
- final role names displayed to users
- migration date/cutover window
