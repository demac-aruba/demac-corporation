# ERP Next — Management Intelligence V1

## Objective
Turn DEMAC management reporting into an operational decision system rather than a collection of static historical reports.

## KPI Command Center

Requirements implemented in this checkpoint:

- KPI-001 — Compare target progress with elapsed time/pace.
- KPI-002 — Show a forward forecast, not only actual-to-date.
- KPI-003 — Group metrics by Company, Finance, Operations, Sales & CRM, Inventory and Communications.
- KPI-004 — Show source and data freshness on each metric.
- KPI-005 — Surface Critical, Warning, Opportunity and Information alerts.
- KPI-006 — Every alert has an owner, next action and due horizon.
- KPI-007 — Forward view interprets the interaction between revenue, collections, expenses and margin.
- KPI-008 — KPI cards are theme-token based and support light/dark mode.

## Executive AI

- EAI-001 — Owner/Super Admin management workspace.
- EAI-002 — ERP calculates truth; AI interprets, explains, forecasts and recommends.
- EAI-003 — Every answer exposes evidence and freshness.
- EAI-004 — Risks and assumptions are visible.
- EAI-005 — Authority model starts Read & Analyze.
- EAI-006 — Controlled future actions follow Analyze → Prepare → Human Approval.
- EAI-007 — Bank transfers, refunds, journal entries, payroll changes, deletes and large purchases remain approval-only.
- EAI-008 — Data-quality state is explicit while preview data is being used.
- EAI-009 — AI tool adapters will later replace preview evidence with Firebase/QBO/banking/inventory/communications facts.
- EAI-010 — Executive AI must never rely on unrestricted SQL or arbitrary database writes.

## Current integration state

This is the interactive management/product layer. Values are structured preview data so the workflow and visual hierarchy can be reviewed live. Firebase, QuickBooks, bank transactions, WhatsApp/voice and production OpenAI tool calls remain disconnected until the persistence/integration phase.
