# DEMAC ERP Next

Greenfield web application for the next generation of DEMAC ERP.

## Intent

- Premium desktop-first ERP experience with responsive support.
- Native light and dark themes.
- Canonical domain model rather than patch-driven screen behavior.
- Clear module boundaries for CRM, scheduling, work orders, communications, inventory, finance, projects and AI.
- Legacy ERP remains untouched while ERP Next is built and validated.

## Local development

```bash
cd apps/erp-next
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm run build
```

## Deployment

Create a separate Vercel project (or a separate Vercel root configuration) with `apps/erp-next` as the project root. Do not replace the current production ERP until migration acceptance criteria are satisfied.

## Integration posture

Firebase, QuickBooks, WhatsApp, telephony, banking readers and OpenAI integrations are intentionally behind future adapters. This foundation does not require new Firebase rules or production credentials.
