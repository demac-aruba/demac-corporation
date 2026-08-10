# DEMAC ERP Next — Product Governance

## Source hierarchy

1. Approved DEMAC business rules and explicit owner decisions.
2. ERP Master Specification and approved requirement IDs.
3. Module specifications and acceptance criteria.
4. Implementation code and tests.
5. Product backlog for proposed/pending ideas.

Generic ERP recommendations extend DEMAC rules; they do not silently override them.

## Requirement lifecycle

`Proposed -> Pending Review -> Approved -> Planned -> In Development -> Testing -> Production`

Additional terminal/non-active states:
- Deferred
- Rejected (with reason)
- Superseded (link replacement requirement)

## Requirement record

Every material requirement should contain:
- ID
- title
- module
- status
- business value
- detailed behavior
- permissions/roles
- dependencies
- acceptance criteria
- date added
- decision history
- implementation PR/commit when available

## ID families

- CORE — architecture, identity, permissions, audit
- UX — design system and interaction behavior
- CRM — customers, contacts, sites, assets and relationship intelligence
- SALES — leads, opportunities, estimating
- SCHED — scheduling, dispatch, capacity and routing
- WO — work orders and field execution
- INV — inventory, warehouses, vans and replenishment
- PUR — purchasing and vendors
- FIN — finance operations, budgets and reconciliation
- BANK — Aruba Bank read-only intelligence and statement reconciliation
- COM — communication workspace and operator collaboration
- COM-VOICE — regular/WhatsApp voice contact center
- AI-CS — AI customer service agent
- AI-EXEC — owner executive copilot
- KPI — management metrics, forecasts and alerts
- HR — workforce/time/skills
- PROJ — commercial/VRF projects
- INT — external integrations
- SEC — security/governance

## Decision log rule

If an approved rule changes, do not silently edit history. Record:
- old decision
- new decision
- reason
- date
- affected requirements/modules
- migration/compatibility consequence

## Product pipeline rule

Ideas worth preserving are captured even when they will not be built now. A pending idea must not be treated as production behavior until it reaches Approved/Planned status.

## Security rule

Never store passwords, API keys, bank credentials, Soft Token values or production secrets in requirements, chat memory, source code or public repository documentation. Use environment variables/secrets management and least-privilege service identities.

## Current greenfield foundation decisions

- ERP Next is additive and isolated from Legacy.
- Legacy receives only critical maintenance while greenfield work proceeds.
- Management ERP is web-first and desktop-first.
- Light/dark themes are foundational, not a later cosmetic feature.
- Firebase integration is deferred behind adapters until the canonical model is approved.
- QuickBooks Online remains the current accounting system of record unless a future explicit decision replaces it.
- The ERP owns operational truth and management intelligence.
- AI starts read-only/analytical and gains authority only through explicit controlled phases.
