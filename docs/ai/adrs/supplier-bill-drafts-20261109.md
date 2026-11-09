# ADR: Shared operational supplier purchase drafts

- Status: Proposed — implemented on a feature branch; live activation requires approval.
- Date: 2026-11-09
- Owner: DEMAC engineering / business owner
- Related task: `../tasks/supplier-bill-drafts-20261109.md`; PUR-DRAFT-001–005
- Supersedes: none. Existing catalog, inventory and QBO authorities remain unchanged.

## Context

The cost editor already prepares multi-line purchases, but only downloadable files survive closing it. Operators need to reopen a shared draft while retaining rate exceptions, final-price choices and correction history. Receiving goods and confirming official accounting costs require canonical catalog/provider links that this draft stage does not yet have.

## Decision

Implement a disabled-by-default Functions service over three private staging collections: `supplierBillDrafts`, `supplierBillDraftClaims`, and `supplierBillDraftOperations`. Each draft has immutable `revisions` children. No direct browser Firestore access or rules change. `SUPPLIER_BILL_DRAFTS_ENABLED=true` is a deployment-controlled activation gate; it is not enabled by this PR.

`functions/supplierBillCosting.js` is the common integer-cent implementation used by browser and server, with declarations for TypeScript. The server strictly validates the input shape, recalculates costs and persists both original inputs and calculation diagnostics. Incomplete drafts can be saved; incomplete does not mean zero. No catalog ID, approval, stock balance, accounting transaction or bank allocation is inferred.

The service verifies a revoked-token-aware Firebase session and re-reads `users/{uid}` inside every transaction, including exact replays. Write roles are existing active `admin`, `owner`, `super_admin`, `superadmin`, `inventory`, `warehouse`. Read adds `supervisor`, `operations`, `accounting`, `finance`, `project_manager`. Unknown, inactive, office-operator and technician roles fail closed. This is a proposed draft-preparation boundary, not import-cost or financial approval. It does not provision users or assign roles; the planned capability settings remain a later step.

Save carries immutable request identity, expected draft version and correction reason. The transaction writes latest record, revision, supplier-label/reference claim and receipt atomically. Repeating the same request returns the original result; changing its content conflicts. Terminal duplicate/version rejection receipts prevent an uncertain earlier request from later committing after a rejection. Revisions are never overwritten. Missing claims or an occupied next revision block for review.

The browser retains the exact request before transmission, scoped to project and authenticated UID, without credentials. A failed/unknown response preserves it across reload. Only a matching success or known terminal rejection retires it. Local-storage failure blocks dispatch; corrupted recovery locks further saves. This local recovery copy is not authoritative or encrypted storage. Shared-device policy and same-origin XSS protection remain deployment concerns.

Supplier names are unverified document labels. NFKC, case and whitespace-normalized label plus invoice reference prevents duplicate drafts for the same label; it does not reconcile aliases, currencies, supplier master records or legitimate reused invoice numbering. Canonical supplier identity and a reviewed duplicate exception policy are prerequisites for promotion beyond drafts.

## Alternatives considered

| Alternative | Benefit | Reason not selected |
| --- | --- | --- |
| Files only | No shared persistence boundary | Cannot provide cross-operator history or concurrency protection. File export remains available. |
| Direct Firestore client writes | Fewer server components | Cannot trust UI authorization/calculations or coordinate claims and audit safely. |
| Save immediately as QBO Bill and receipt | One-step workflow | Catalog, receiving, cost-finalization and QBO mappings are not approved or implemented; risks duplicate stock/cost recognition. |

## Consequences and operations

- Lists and history are paged at 20 records/revisions. Maximum 100 draft lines; request size bounded; Functions max instances 5. Revision and operation history grows; no TTL/deletion policy is introduced.
- The claim and operation identifiers hash inputs. Financial payloads stay in private documents; logs contain safe status/code only.
- QBO remains the accounting authority. `accountingStatus:not-sent` and `inventoryStatus:not-received` are explicit draft metadata, never reconstructed accounting balances.
- Existing JSON files remain readable; importing a file resets price confirmations. Shared snapshots retain reviewed draft choices.
- Corrections append a new version and reason. A support reconciliation must preserve uncertain request and claim evidence; deleting local recovery is not a supported no-commit guarantee.

## Verification and rollout

Acceptance: 9 service/HTTP tests, 5 client recovery/transport tests, 5 existing costing tests, typecheck, Functions validation and Next build; isolated browser exercises use actual UI/transport/service with a synthetic transactional store. No real supplier, production Firebase or QuickBooks data was used.

Before activation: explicit approval of this proposed persistence/access boundary, nonproduction Firebase smoke tests for indexes/transaction semantics and disabled/enabled function deployment, verified role mappings, and operational recovery ownership. No live authorization assertion is made by synthetic tests. Supplier/catalog linkage is required before any stock/accounting promotion.

Rollback: keep activation false or restore the prior function/UI deployment; preserve all revisions/receipts/claims for reconciliation. No data migration or destructive rollback. Review again when receipt, final import costs, catalog publication or QBO send is introduced.
