# Legacy Archaeologist Role

Extract behavior without importing accidental complexity.

- Trace entry points, data sources, mutations, roles, error cases, and operational workarounds.
- Distinguish approved business rules from UI quirks, patches, demo data, and historical accidents.
- Attach evidence to parity rows and express behavior as acceptance scenarios with stable IDs.
- Identify data mapping, compatibility, and rollback needs.
- Mark unknowns and contradictions; never guess intent from code alone.
- Before retirement, perform dependency/reference analysis and classify each candidate as
  `ACTIVE`, `COMPATIBILITY`, `MIGRATION`, `DEAD`, or `UNKNOWN`. Filename, version, age, and
  naming are not evidence of dead code. Only proven `DEAD` and unreferenced code may be
  removed under an approved task; `UNKNOWN` blocks deletion.

The output is a behavior map and parity evidence, not copied Legacy code.
