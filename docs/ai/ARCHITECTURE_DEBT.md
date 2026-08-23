# Architecture Debt Register

| ID | Debt | Risk | Exit condition |
| --- | --- | --- | --- |
| AD-001 | Root package depends on sequential source-patching scripts before start/typecheck/build | Non-reproducible changes and fragile builds | Replace generated patch chain with reviewed source and clean deterministic build |
| AD-002 | Legacy is described as demo/local persistence while production-capable Firebase functions coexist | Boundary and data-flow ambiguity | Publish environment-specific runtime/data ownership map |
| AD-003 | Legacy and ERP Next duplicate product concepts | Rule drift and inconsistent identity | Canonical contracts and parity ledger cover every migrated module |
| AD-004 | Quality gates are fragmented across package scripts and path-filtered workflows | Changes can miss relevant validation | One documented, dependency-aware required check set |
| AD-005 | Multiple external communication and deployment paths exist | Duplicate messages or partial rollout | Single communication authority and deployment inventory with owners |
| AD-006 | ERP Next acceptance scripts generate temporary compiled directories | Cleanup and CI consistency risk | Adopt a standard test runner with isolated managed artifacts |
| AD-007 | Repository documentation is extensive but lacks uniform status/ownership metadata | Stale guidance may appear authoritative | Add owner, status, reviewed date, and supersession links to governing docs |

Debt changes require evidence. Do not erase an item because a partial mitigation exists;
link the verifying change and record residual risk.
