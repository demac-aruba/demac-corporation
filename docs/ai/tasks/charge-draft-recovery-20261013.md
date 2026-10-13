# Task: recover actual-work drafts after receipt entry and refresh

Deep Review: owner reported that three 125 AWG services disappear after saving a
250 AWG payment and refreshing. Reproduced with real components, Office facade and
synthetic transactions: receivedCents=25000, final=null, zero restored lines.
Previous regression finalized before reload and missed this path.

Scope: per-user/per-appointment sessionStorage recovery of the actual-work form,
clear pending-confirmation status, explicit discard, close/unload guards, and exact
recovery of an uncertain monetary request. Drafts are private form inputs, not a
new financial authority. No server/schema/rules changes or production data writes.
Prices and receipts always come from authorized reads and quotes. Confirmation
and Field reconciliation stay explicit. Same-tab recovery does not promise access
from another device or after browser session storage is erased.

Gates: exact 375/250 case refresh before finalization; stale financial changes and
same-total different services; lease-only version changes; lost acknowledgement and
exact retry without duplicate cash payment; failed/corrupt storage; user/cita
isolation, sign-out cleanup; drawer closes; final confirmation/PDF; existing browser
regressions, typecheck/build and independent review. Prior work already discarded
by the old version cannot be fabricated or silently backfilled in production.

## Verification before release

- Reproduction before correction: saved receipt 25000 cents, final null, zero lines
  after reload before final confirmation. This demonstrated the gap in the old test.
- 7 recovery acceptance groups passed: bounded decoding, identities, baseline comparison,
  receipt identity, exact envelopes, explicit logout, and proven no-commit fencing.
- 6 real component/HTTP/Office facade transaction flows passed: desktop 1440, laptop
  1366, mobile 390, owner's 375/250/125 sequence through reload/final/PDF, uncertain
  cash/auth-denied/cross-user/reload exact replay, and never-committed expiry/fence.
  A final wait was corrected to observe payment controls enabled, not the temporary
  absence of a retry notice during busy; all financial assertions remain required.
- 56 drawer loading/concurrency/responsive cases passed, including recovery at all close
  paths, changed review baseline, quota failure, corrupt copies and no writes while typing.
- Real session transport/storage: 41 cases; actual AuthProvider Chromium: 18 groups.
  Added fixture cleanup after the new retained-recovery assertion so later tests remain
  isolated; the existing invalid-session/storage assertion remains unchanged.
- ERP typecheck and full prebuild/build passed. No new dependency. Generated Next config
  edits are excluded from the change. Existing remote CI remains required before merge.
- Local synthetic performance: 1000 catalog articles, 59 editable lines, 40 rendered search
  results, editor ready 827ms, input-to-two-animation-frames median 71ms/p95 142ms across 15
  samples. Zero authority/network requests while typing. These are local measurements,
  not a claim about production latency. Financial baseline serialization is memoized.
- Actual drawer screenshots inspected at 1366/1600: recovery status stays compact; search
  and confirmation footer remain accessible while the list scrolls independently.

## Release/recovery boundary

Repository demac-aruba/demac-corporation; fix/charge-draft-recovery targets main.
Production https://www.demac-aruba.com/ is Vercel project prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7
in team_DMKv1yhhUjnR4Pu141k3iwuX. Prior production deployment verified READY:
dpl_GNTpKykhvxH5uLb478ggNsz7YstQ, both apex/www aliases. It is the frontend rollback
baseline. Keep real receipts/final values on rollback; no data deletion/backfill/migration.
Publish the reviewed commit only after independent review and all applicable CI, then
verify the active deployment/source and public routes/assets without customer writes.
Same-tab recovery and erased-storage limitations remain explicit. Production financial
CRUD is deliberately not exercised; domain/browser writes above are synthetic only.
