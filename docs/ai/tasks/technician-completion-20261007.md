# Task: finish PR 526 from its verified recovery checkpoint

## Context

Owner request, 7 October: continue the outstanding checklist and check off each
item only after it is saved and verified. Starting head: 4c76b371. The previous
native-audio gate passed 19 controller + 12 Chromium + 12 WebKit scenarios.
The owner excludes hosted preview from the critical path. No merge/deploy or
production activation is authorized. The current main must be reconciled.

## Scope

Complete private photo thumbnails/enlargement, protect authored form drafts,
verify the existing add-on, two-person execution, closure, customer acknowledgement
and Office review flows, integrate current main, and record final gates/rollout.
Physical-phone acceptance remains distinct from automated browser evidence.

## Governance

Deep Review / Solo Maintainer Adversarial Review, not independent review.
Field Operations Authority remains the only execution/review source of truth.
The existing account/context-scoped IndexedDB forms store contains authored text
only. Saving or restoring a draft never sends a command, changes a safety phase,
approves work or creates another business record. No permission/rules change.
Existing media read authorization and hash verification remain mandatory.
No new database schema, migration, prices, inventory, billing or communications.

## Acceptance criteria

- [x] Private photos load only when visible, show compact thumbnails, and enlarge
      the same verified bytes in an accessible dialog with keyboard focus return.
- [x] Media URLs are revoked on close, backgrounding, session invalidation and unmount.
- [x] Authored coordination, exception and recovery text survives reload/offline;
      physical safety confirmations always require fresh interaction.
- [x] Quota/read failure retains originals; stale tabs cannot overwrite silently;
      an explicit comparison is required to resolve a draft conflict.
- [x] Complete existing 14/9 flow and account/authority/recovery tests still pass.
- [x] Final checklist evidence names the exact source head and remaining limits.

## Plan and risk

Use the existing viewer, capture store and draft hook. Add private thumbnail/dialog
presentation and connect previously in-memory procedure forms. Keep permission and
command validation on the server. Freeze authored inputs during a command; clear
them only after a confirmed response. Risk-resolution text records the risk ID and
cannot confirm another risk without review. Safety revision changes clear local
physical attestations. Draft comparison retains both texts until the user chooses.

Rollback: revert UI entry points while retaining original capture/draft/revision
readers and canonical closure/authority controls. No data deletion is involved.

## Verification

Required: app typecheck, Chromium/WebKit visible workflow and draft recovery,
private original transport tests, current native audio gate, final app build and
Field backend/auth/emulator gates after integration. Existing gates are retained.
Local browser installation failed to download a valid archive; use the existing
authorized GitHub CI, never treat that local limitation as a browser pass.
Results and the separate adversarial review will be appended after verification.

## Verified increment: f1cba8ad (7 October)

- [x] Thumbnail/enlargement and keyboard return: Chromium/WebKit complete visible
  14/9 workflow. UI run 37701800242, job 113066740581, success.
- [x] Procedure forms: 11 recovery checks per engine, including quota failure,
  explicit stale-tab comparison, account isolation and fresh physical confirmations.
- [x] Private original recovery: 19 checks per engine; exact hash, lost response,
  assignment revocation, changed coordination and unsent-original retention.
- [x] Shared parts at 360/390/desktop and coordinated final test, both engines.
- [x] Native audio unchanged: run 37701505674 success, 19 controller + 12 per engine.
- [x] Visit-wide authored forms and Office review notes: completed and verified in
  the final increment below.
- [x] Reconcile current main and final required checks / separate adversarial pass:
  completed in the final increment below.

Visit-form implementation keeps real user/Work Order/Visit identities in the existing
IndexedDB `forms` store. Captures and command journals still require the full procedure
context. Separate forms protect proposals, verbal decisions, execution notes,
measurements/findings/captions, free text, customer acknowledgement, Office correction,
Office reviewer notes, visit dispositions and equipment text. Old free-text drafts are
read and copied without deleting their original. A changed server version requires an
explicit comparison before sending. Existing non-procedure upload file selectors are
protected by exit guards, but those legacy selected files are not claimed to survive a
forced reload; full original recovery above applies to the procedure capture workflow.

## Final verified implementation: 54c02f41 (7 October)

Source head: `54c02f419181df9b257efd98721d469aba532571`.
Main `c45d51d03840019cbfe68a2ca9ae5e067532077f` was integrated into this branch
at `5f7c6fbb`; both parents' backend test scripts and saved visit references remain.
All 22 pull-request workflows on this source head completed successfully. Duplicate
push audio/UI runs were cancelled by existing concurrency; their pull-request runs
passed. No required gate was disabled, weakened or treated as passed by cancellation.

| Evidence | Result |
| --- | --- |
| [UI and drafts](https://github.com/demac-aruba/demac-corporation/actions/runs/37704314893) | 13 draft-recovery checks and 14 actual visit-form reload/offline cases per engine, Chromium and WebKit; six shared-part viewport cases; complete visible 14/9 workflow; combined photo/audio/video with native playback; 19 original-recovery checks per engine and 32 backend-response/provenance checks. |
| [Native audio](https://github.com/demac-aruba/demac-corporation/actions/runs/37704314845) | 19 controller checks plus 12 Chromium and 12 WebKit/macOS scenarios, using native MediaRecorder and playback. |
| [Backend integration](https://github.com/demac-aruba/demac-corporation/actions/runs/37704314813) | 425 Field tests and real Auth/Firestore/Storage/HTTP emulator flow: concurrent reservations, access rejection, private originals, final test and immutable Office return/resubmit/approval. |
| [ERP Next CI](https://github.com/demac-aruba/demac-corporation/actions/runs/37704314772) | Typecheck, production build, all existing ERP acceptance checks, 425 Field tests, 235 booking tests and scheduling/attendance/bonus browser regressions. |
| [TypeScript/web](https://github.com/demac-aruba/demac-corporation/actions/runs/37704314917) | Success. |
| Other existing PR gates | Session resilience, Work Order, workforce, marketing, Field authority, customer architecture/production, Office booking, WhatsApp connectors/production, Task Tracker, technician workspace/isolated review, property dwellings, historical bookings, project budgets and Performance Health Center all succeeded on the same head. |

Visual inspection covered the mobile shared-parts and service-selection screenshots
and desktop customer acknowledgement. Automated layout checks covered 360/390-pixel
and desktop viewports. Pre-visit no-access/cancel drafts use the actual Work Order
identity without inventing a Visit. Legacy 5,000-character drafts remain recoverable;
oversized replacements preserve the earlier durable text and require correction.

## Checklist del propietario

- [x] ~~Fotos privadas: miniaturas, ampliación y retorno por teclado.~~
- [x] ~~Foto, audio y video en el mismo procedimiento; recuperación de originales.~~
- [x] ~~Texto de formularios protegido ante recarga, desconexión y conflictos.~~
- [x] ~~Hallazgos/adicionales: catálogo, decisión del cliente y ejecución.~~
- [x] ~~Trabajo simultáneo de técnico/ayudante y finalización de partes.~~
- [x] ~~Prueba final y cierre por el responsable.~~
- [x] ~~Constancia verbal e inmutable del cliente; no firma dibujada.~~
- [x] ~~Envío, devolución, corrección, reenvío y aprobación de Oficina.~~
- [x] ~~Integración de main y controles automáticos del código final.~~
- [x] ~~Verificación visual móvil/escritorio y revisión adversarial documentada.~~
- [x] ~~Guía de activación, recuperación y reversión actualizada.~~
- [ ] Prueba en teléfono físico y aceptación operativa del propietario.
- [ ] Merge, despliegue y activación de catálogo, solo con autorización expresa.

Review: `docs/ai/reviews/technician-completion-20261007.md`.
Physical-phone steps and release order: `docs/technician-portal-v2/activation-pr526.md`.
The PR remains Draft. The final documentation-only commit records this evidence;
it does not change the verified application, backend, fixtures or workflows.
