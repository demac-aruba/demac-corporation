# System Map

Status: living foundation document. Confirm details against code before changing a boundary.

## Product surfaces

| Surface | Location | Runtime | Responsibility | Posture |
| --- | --- | --- | --- | --- |
| Legacy ERP / Field app | repository root, `src`, `App.tsx` | Expo 57, React Native, web/Android | Existing MVP and operational fallback | Stabilize; critical fixes only unless explicitly scoped |
| ERP Next | `apps/erp-next` | Next.js 16, React 19 | Greenfield management ERP | Primary home for new ERP capability |
| Backend authority | `functions` | Firebase Functions, Node 22 | Authenticated writes, scheduling, communications, integrations | Privileged and production-sensitive |
| WhatsApp bridge | `services/whatsapp-bridge` | Node service | Provider transport boundary | No independent business truth |
| Data security | `firestore.rules`, `storage.rules`, `firebase.json` | Firebase | Client-access enforcement and deployment config | Security-critical |
| Delivery | `.github/workflows`, `vercel.json`, `eas.json`, `ops` | GitHub Actions/Vercel/Firebase/Expo | Validation and deployment | Some pushes to `main` deploy production |

## Current authority notes

- Booking Authority owns commit-time scheduling validation and writes.
- Inventory catalog and stock truth is split by item type: `services` owns the canonical
  commercial Product / Service catalog; `commercialProductStock` owns sellable Product stock
  and location balances; `warehouseInventory` owns material / consumable stock and location
  balances; `toolCatalog` owns the Tool catalog; and `vanToolAssets` owns physical Tool assets.
- Warehouse, Office, and Vans are locations, not separate item catalogs. `inventoryTransfers`
  owns workflow/custody state only, while immutable `inventoryMovements` records physical
  movement audit only. Neither is a stock ledger or canonical balance authority.
- Firebase `inventoryAuthority` is the authenticated transactional operation boundary. It
  updates the existing canonical stock records atomically and does not create another catalog,
  stock ledger, or Product, Consumable, Material, or Tool authority.
- `staffProfiles` owns employee master identity. Firebase users authenticate people but do
  not create a second employee master.
- Canonical Customer, Property, and Contact records own CRM identity;
  `contactPropertyAssignments` owns Contact-to-Property communication responsibility.
- DEMAC ERP owns operational workflows. QuickBooks Online is the planned/official accounting
  system of record for accounting workflows and is reached through a governed adapter.
- `wacli` is the current default production transactional WhatsApp provider unless explicit
  canonical configuration activates another provider such as Meta.
- Browser/localStorage and `browser-*` operational models are preview/compatibility and
  non-canonical unless a specific approved architecture document says otherwise.

### Property and Site terminology

`Property` is the canonical business identity for a customer's service location. Current
domain contracts and compatibility code also use `Site` and `siteId` for that same Property
record, especially when locating Assets and preserving existing references. `Site` is a
technical/domain synonym or compatibility representation of Property, not a second identity,
database, collection, or source of truth. Agents must map existing `Site`/`siteId` references
to the canonical Property identity and must not create parallel Property and Site records or
storage. Any future proposal to separate those concepts requires an approved ADR and explicit
human approval for the new source-of-truth boundary.

## Canonical business flow

`Customer -> Property (technical/compatibility name: Site) -> Asset`

`Customer -> Contact -> contactPropertyAssignments -> Property`

`Lead -> Opportunity -> Estimate -> Appointment -> Work Order -> Review -> Invoice -> Payment`

`Work Order -> Assignment -> Labor + Materials + Evidence`

`Canonical Catalog Item -> Location -> Canonical Stock Record -> audited physical movement`

`Conversation -> Communication Case -> governed business action`

Every material mutation should emit or preserve an audit event.

## Dependency direction

Presentation calls application/domain services. Domain services own invariants.
Adapters translate Firebase and external-provider contracts. AI calls allowlisted,
governed tools; it does not bypass services or write databases directly.

## Change routing

- New ERP behavior: `apps/erp-next` plus its backend adapter/authority when needed.
- Legacy operational defect: root/`src`, with a regression test and no scope expansion.
- Privileged mutation or external side effect: `functions`, with auth, validation,
  idempotency, audit, failure, and replay behavior documented.
- Shared rule changes: update the authoritative rule source and all consuming tests;
  do not add another copy.
