# DEMAC ERP Next — Technician Portal Canonical Architecture

Status: Phase 0 architecture checkpoint + architecture design checkpoint + Slice 1 implementation checkpoint
Date: 2026-08-24
Scope: ERP Next field execution only. Legacy remains operational fallback; production deployment is out of scope.

## Architectural rule

Scheduling records what DEMAC expected before arrival. Field Operations records what actually happened on site. Planned scope is immutable historical intent; actual field scope is discovered progressively and must never rewrite the appointment quantity or work lines.
