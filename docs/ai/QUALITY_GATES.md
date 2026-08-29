# Quality Gates

Quality gates are **stage- and risk-aware**. Run only gates relevant to the changed surface plus
transitive consumers. Never run a destructive, deployment, migration, or production command as
verification.

Required tests and checks may never be disabled, skipped, weakened, deleted, waived, or bypassed
merely to obtain `PASS`.

## Product-review gates

Used before **🟡 READY FOR PRODUCT REVIEW**. Their purpose is to prove the concept is coherent
enough for the owner to evaluate without paying the cost of final release validation repeatedly.

Minimum expectations:

- Authority & Safety Check completed.
- Diff is scoped and contains no secrets/debug junk.
- Relevant syntax/type check or equivalent focused static validation.
- Focused test/manual scenario for the requested happy path.
- Focused negative/failure case when the feature writes authoritative data.
- Known limitations stated.

Risk adjustments:

- LOW: focused UI/static/manual verification may be sufficient.
- MEDIUM: focused domain regression is expected for changed business behavior.
- HIGH: critical authorization, financial/data invariants, idempotency/recovery, and other
  safety gates cannot be deferred just to reach product review.

A full application build is **not automatically required** for every product-review iteration.

## Engineering-hardening gates

Run after the owner accepts the product behavior, or earlier when HIGH risk requires it.

- Complete authority/source-of-truth review.
- Inspect affected callers and transitive integrations.
- Verify domain layering and remove prototype-only duplication/shortcuts.
- Permissions/security/privacy cases.
- Concurrency/retry/idempotency where applicable.
- Failure/recovery/partial-success behavior.
- Data/history preservation.
- Required regression coverage.
- Documentation, parity, debt, business rules, authority matrix, and ADRs updated when evidence
  changes them.
- Reviewer findings recorded separately from Builder claims. Solo Maintainer Adversarial Review
  is valid when no independent reviewer is available.

## Final release gates

Required before **🟢 READY FOR MERGE** where applicable:

- Scope and owner-accepted behavior remain satisfied.
- Final diff contains only intended changes.
- All applicable required tests pass on the final code head.
- Release-impacting type/syntax/build checks pass.
- Applicable integration/regression suites pass.
- Review findings are resolved or residual risk is explicitly recorded.
- Branch/PR is current and mergeable.
- Human Approval Boundary is satisfied for any production/destructive/security action.

A failing applicable final gate remains `FAIL` until fixed or an authorized resolution changes the
requirement itself. It cannot be waived into `PASS`.

## Surface commands

| Surface | Product-review evidence | Final release evidence |
| --- | --- | --- |
| Legacy Expo | Read Expo 57 docs; focused type/manual flow | `npm run typecheck`; relevant focused/regression flow; `npm run build:web` when release-impacting |
| ERP Next | Focused typecheck and relevant `test:*`/manual flow | `npm run typecheck --prefix apps/erp-next`; relevant regression `test:*`; `npm run build --prefix apps/erp-next` for integration/release |
| Functions | Syntax/focused test for changed function | `npm run validate:firebase --prefix functions`; relevant `test:*` or focused `node --test` suites |
| Firebase rules | Focused emulator allow/deny for changed rule | Complete applicable emulator allow/deny suite before deployment |
| Documentation only | Link/path, consistency, whitespace/diff check | Same; application build is N/A unless docs generate/runtime-affect code |

Note: root lifecycle scripts execute the legacy patch chain. Inspect them and obtain the
appropriate authority before running any root `npm` script that triggers `pre*` hooks.

## Build-cost gate

Before pushing or requesting a remote build, ask whether the current stage actually needs it.
Batch coherent edits. Avoid docs-only application builds. In multi-project hosting, use path
filters/ignored builds so unrelated projects do not rebuild where supported.

A code change after a passing code gate invalidates that relevant gate. A documentation-only
change does not automatically invalidate compiled-code evidence unless it changes generated or
runtime-consumed artifacts.

## Stop conditions

Do not merge when an applicable final gate fails, production authority is ambiguous, security
controls are only client-side, migrations lack reconciliation/recovery, or critical behavior has
no regression evidence. A gate that is genuinely not applicable may be marked `N/A` with
evidence.
