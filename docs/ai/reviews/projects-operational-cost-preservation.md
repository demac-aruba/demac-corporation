# Projects operational-cost clarification — Deep Review

Scope: preserve existing monetary budgets and local manual expense evidence; separate
original/current revisions and operational/accounting states; remove the artificial QBO
prerequisite. Future photo/audio/general expense capture is documentation only.

Epicurus independently inspected available sources and active callers without editing.
The audit identified real manual `vanMaintenanceLogs`, browser expense/cost arrays, static
Finance previews and missing shared allocation/category/evidence contracts. It found that
loading the active browser planner could rewrite filtered originals, including a modified
sample-ID Project containing approved expenses. Loads are now read-only projections;
filtered/unreadable sources pause saving instead of being erased. Existing raw recovery
and import archives remain the migration path; no real source was changed.

Laplace independently reviewed the budget/service/UI/storage diff. Two P1 findings were
fixed: the client intent allowlist initially omitted `revise_material_budget`, preventing
all requests; and the legacy Scheduling writer still normalized or replaced unreadable
browser originals. Exact-request journal coverage now includes monetary revision. Both
browser writers validate/re-read raw storage and share the existing lock. Legacy Scheduling
preflights the stored Project before confirm/hold and rechecks when saving its link.

The reviewer rechecked actual code in memory: journal reload preserves exact amount/reason,
raw-storage acceptance passes corrupt/duplicate/modified-sample/Service-budget/extension
cases, dialog reset binds ID/version, and both preflights precede Booking calls. No remaining
actionable finding in that bounded review. The reviewer did not run emulator/browser suites.

Backend review confirmed authorization, expected version, closed-plan/write-pause handling,
original-budget preservation, imported/not-recorded provenance, atomic before/after/reason
history and exact receipt replay. Metadata cannot bypass budget revision. Van estimates,
expenses, stock, appointments and accounting state are not changed by this command.
The local evidence view is read-only, exposes provenance and missing currency, and does
not add potentially duplicate expense/cost rows or certify an unknown balance as zero.

The combined review found one further P2: #515's strict budget arithmetic throws on
incomplete legacy hours accepted by the earlier shallow storage validator. The validator
now requires finite non-negative estimated/actual/scheduled hours, preserving malformed
originals behind recovery instead of crashing. Acceptance and browser scenarios include
missing hours; no historical value is defaulted or rewritten. The standalone #515 browser
harness also lacked compile-time environment values for current clients. A separate local
companion commit `530b7cb0` on #515 supplies explicit synthetic/default-off flags; it changes
no product behavior or assertion. Combined CI pins that reviewed successor and runs its
browser contract. Publish the companion before the dependent #514 continuation only after
release authorization; neither branch was pushed in this task.

Builder checks are recorded with exact candidate/combined provenance in
[merge readiness](../tasks/projects-merge-readiness-20260920.md). Initial browser harness
failures were retained: the response-loss injector needed explicit support for the new
action; separate rapid local reload scenarios interrupted WebKit sidebar availability
requests. The injector's exact-payload/single-commit assertions and the browser oracle's
fatal DOM/unclassified-error controls remain in force. Storage scenarios wait for the
preceding route's network reads to settle before the next reload.

Residual limits: legacy Booking plus browser link is still a two-stage flow and can report
pending after a concurrent source change; the central bridge is the atomic path. Local
records do not establish shared approval/currency/history. A Project source lacking verified
expense allocations cannot yield certified balances. No new expense authority, payment,
QBO, Inventory or AI writer was introduced. Isolated deployed staging and real-source
backup/reconciliation/restore and release approval remain open. This review does not waive
those gates or authorize publication/production changes.
