# Task: Editable descriptions on actual-work lines

## Context and scope
Owner requests removal of the separate mandatory reason/scope-detail textarea and a QuickBooks-style editable description beside every selected catalog article. This changes the Next ERP actual-work editor and the privileged charge validator; use focused Deep Review. No migrations, catalog-price edits, QBO writes, customer communications or production-data tests.

## Governance
Authority remains officeBookingAuthority / appointmentCharges; OPS-SCHED-CHARGES-001/002. Optional line metadata uses the existing record, history, recovery and PDF paths. Permission, expected-version, lease, idempotency, original projection and immutable receipt rules remain unchanged. No new source of truth or ADR required.

## Acceptance
- [x] Description starts from catalog text and can be edited/cleared; quantity and tariff identity remain separate.
- [x] No reason textarea or final reason requirement; explicit scope/Field review still required.
- [x] Saved descriptions survive reopen, old-client omission, retries and PDF output.
- [x] Invalid descriptions are rejected; absent fields preserve old quote tokens and request fingerprints.
- [x] Automatic before/after actor history and reasoned receipt voids remain.

## Risk and publication
Backend must precede frontend. Read-only live-source audit compares the exact existing package and patches only appointmentCharges.js, preserving configuration, IAM and traffic. No schema migration. If UI rollback is needed, retain the description-aware backend to protect descriptions already saved; use a forward fix for backend defects rather than returning to a writer that drops metadata.

## Verification
45 backend tests, 7 HTTP/browser financial flows, 63 drawer scenarios, typecheck and 10 balance/PDF checks. Independent reviewer additionally checked old/new golden compatibility and typing/recovery at 1440/1366/390 with zero extra quote requests. Required CI, live-package audit and non-destructive post-publication checks remain release gates. Real customer writes are deliberately untested.

Release evidence: read-only audit run 38467175713 passed on fb3464ddceca8c6a942db47ebb8ca1a565c653ab. Exact live package baseline passed 126 tests; single-module candidate passed 127 plus runtime smoke. Configuration, IAM and active traffic matched before/after audit. Controlled source-only release reuses the reviewed catalog release mechanism, changing only task names/audit reference. Its 19 transport, retry and safety tests pass.
