# ERP Next — Start Authority Evidence V1

## Objective
Make every Field start explainable from one exact authority source: normal consolidated READY or a specific Operations AT RISK release.

## Requirements

- **START-AUTH-001** A Field Execution start stores its authority mode: `ready` or `released_at_risk`.
- **START-AUTH-002** A start under AT RISK authority stores the exact dispatch release ID used at start time.
- **START-AUTH-003** Field stores the start-authority reason alongside the start timestamp.
- **START-AUTH-004** Start authority is captured only when the physical Field start occurs; later readiness changes do not rewrite it.
- **START-AUTH-005** Reopening a returned Office Review does not replace the original start authority.
- **START-AUTH-006** Dispatch release history is append-preserved instead of replacing prior release evidence for the same Work Order.
- **START-AUTH-007** Only the latest release for a Work Order can be considered for current start authority.
- **START-AUTH-008** The latest release must match the current AT RISK signature to remain valid.
- **START-AUTH-009** Historical releases remain available to Audit/Customer 360 even when no longer valid for current dispatch.
- **START-AUTH-010** Command Center distinguishes AT RISK jobs awaiting release from AT RISK jobs with a valid Operations release.
- **START-AUTH-011** Command Center counts Field Executions that actually started under AT RISK authority.
- **START-AUTH-012** A valid release does not mutate the Work Order from AT RISK to READY.
- **START-AUTH-013** Audit Field-start events identify whether the start used READY or an AT RISK release.
- **START-AUTH-014** Customer 360 Field-start events identify the same authority without implying the customer approved the operational risk.
- **START-AUTH-015** Legacy browser starts without authority metadata remain readable and are labeled as legacy/unknown rather than guessed.
- **START-AUTH-016** Production authority must ultimately use authenticated Operations identity and server-side transactional validation.

## Decision chain

`Consolidated Readiness → Operations Release if AT RISK → Start Work → Persist Start Authority → Audit / Customer 360 / Command Center`

## Guardrail
A release is permission to begin under a reviewed risk snapshot. The Field start record is the evidence that work actually began. They remain separate events and separate facts.

## Current data mode
Browser-persistent preview records only. Production migration will move release history and start-authority evidence into authenticated repository-backed event/transaction records.
