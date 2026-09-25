# Owner-directed live review path — 2026-09-25

The owner explicitly set public preview aside and requested continued programming,
then notification when the application is ready for merge/deploy and live review.
This replaces the prior public-preview prerequisite; it does not make incomplete
code or failed functional checks ready for production. Do not repeat the Google
project-creation request or restore an external tunnel. The original functional,
authentication, private-media, concurrency, visual-fidelity and review requirements
remain. Continue on PR 526's task branch; no automatic production writes/tests.

This bounded checkpoint starts at a90372670434dcfe3707cedece1173f345039fbe.
The isolated-review workflow retains every actual internal build/type/role/browser/
emulator/API check. Its final administrative `exit 1` for an unavailable public
preview is replaced with an accurate scope note documenting the owner's decision.
This is an explicitly superseded deliverable, not removal of a failed technical
assertion. Existing failed runs remain failed. The shared-part browser case still
fails and must be diagnosed/fixed; a step-specific log artifact now retains the exact synthetic diagnostics
instead of requiring the unbounded combined CI log. Pipeline failure remains
enforced by `set -euo pipefail`.

No business code, credential, IAM/rule, billing, infrastructure, public hosting or
production setting changes in this checkpoint. Other in-progress capture/editor
files are not included or claimed complete by this commit. The full internal
scenario and final visual comparison remain prerequisites to a readiness report.

Review mode: Deep Review continuation, separate Solo Maintainer Adversarial Review
(not independent). Inspected the entire two-file diff: each pre-existing browser
assertion and build/emulator gate remains unchanged; all failure exit behavior
remains except the owner-superseded administrative preview prohibition. The
failure artifact contains only synthetic test diagnostics, not production data,
passwords or tokens. YAML parsing and whitespace checks passed locally. Exact-head
CI results must be checked after publication; no pass is assumed here.

Before a later production activation, record exact frontend/backend/rules/catalog
changes, verify compatibility against current main and deployed runtime, stage
necessary backend readers before opting services into protocol v1, preserve
rollback/read compatibility for versioned media and active work, and tell Christian
what is ready. A green CI for this checkpoint alone does not approve the entire app.
