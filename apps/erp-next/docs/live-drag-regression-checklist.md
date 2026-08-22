# LIVE Drag Regression Checklist

Use this checklist when changing Scheduling capacity rules:

1. A normal Monday-Saturday day renders the same start keys used by `liveDragMoveCandidates`.
2. Sunday/company closures expose no move targets.
3. A van half-day keeps valid morning targets and removes afternoon targets only for that van.
4. Maintenance/out-of-service vans expose no targets.
5. Existing appointments block overlapping targets.
6. Multi-van appointments do not enter simple drag mode.
7. Booking Authority revalidates the selected target at commit time.

The automated Saturday parity acceptance test covers the specific mismatch that caused the 2026-08-22 regression.
