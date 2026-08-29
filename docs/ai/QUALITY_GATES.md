# Quality Gates

Select the delivery mode defined in the root `AGENTS.md`, then run only gates relevant to
the changed surface and necessary transitive consumers. Never run a destructive,
deployment, migration, or production command merely as verification.

## Fast Product Validation gates

- The requested behavior and acceptance signal are understood.
- Git diff contains only intended changes and no secrets, generated junk, or debug output.
- Types/syntax and focused tests for the changed surface pass.
- The visual or interactive flow is published to preview when applicable and validated by
  the owner before merge.
- Authorization, failure-path, concurrency, and recovery checks are required only when the
  change touches those behaviors.
- A separate reviewer record, task template, ADR, and broad documentation sweep are not
  required unless the change itself changes their evidence.

## Deep Review gates

- Scope and acceptance criteria are explicit; business-rule and authority impacts are mapped.
- Git diff contains only intended changes and no secrets, generated junk, or debug output.
- Types/syntax, focused and transitive tests, negative authorization cases, and relevant
  failure/recovery paths are verified.
- Documentation, parity status, debt, and ADRs are updated when their evidence changes.
- Reviewer findings are recorded separately from Builder claims. In Independent Review mode,
  the reviewer did not implement the reviewed change. In Solo Maintainer Adversarial Review
  mode, the same maintainer may perform the review only as a fresh, explicitly separate
  adversarial pass and must not represent it as independent.

## Absolute gate rule

- Required tests and checks may never be disabled, skipped, weakened, deleted, waived, or
  bypassed merely to obtain `PASS`. A failure must be fixed or explicitly escalated with
  the failing evidence; it remains a failure until the authorized resolution is recorded.

## Surface commands

| Surface | Minimum automated evidence |
| --- | --- |
| Legacy Expo | Read Expo 57 docs first; `npm run typecheck`; relevant focused/manual flow; `npm run build:web` when release-impacting |
| ERP Next | `npm run typecheck --prefix apps/erp-next`; relevant `test:*`; `npm run build --prefix apps/erp-next` for integration/release |
| Functions | `npm run validate:firebase --prefix functions`; relevant `test:*` or focused `node --test` suites |
| Firebase rules | Emulator-based allow/deny tests before deployment |
| Documentation only | Link/path validation, consistency review, whitespace/diff check |

Note: root lifecycle scripts execute the legacy patch chain. Inspect them and obtain the
appropriate authority before running any root `npm` script that triggers `pre*` hooks.

## Stop conditions

Do not merge when an applicable gate fails, production authority is ambiguous, security
controls are only client-side, migrations lack reconciliation/recovery, or critical behavior
has no regression evidence. A gate that is genuinely not applicable may be marked `N/A`
with evidence. An applicable failed or required gate cannot be waived into a passing result.
