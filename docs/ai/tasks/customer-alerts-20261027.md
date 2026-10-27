# Task: Internal customer alerts in CRM and office scheduling

## Context and authorization
Owner approved the two visual proposals and implementation, publishing, merge and production deployment on 2026-10-27. Real customer and appointment data must remain intact. Delivery mode: Deep Review (new internal incident records and cross-module reads).

## Scope and authority
Office Booking Authority owns private `customerAlerts` records and append-only child events. Canonical `clients`, `properties` and dwelling identities are read only. Existing office roles (admin, office, supervisor) can read and manage alerts. No direct browser Firestore access, notification production, financial inference, customer merge, historical backfill or automatic refusal of service.

## Acceptance
- CRM and appointment detail expose the same customer-owned alerts, creation, history, resolution and reasoned invalidation.
- Booking warns on canonical identity or normalized exact phone/address matches before confirmation or temporary hold.
- Shared addresses, dwelling units and recycled phones are possible matches, never identity proof. Reasoned new-occupant exceptions are specific to another customer and the observed identifiers; direct owner alerts cannot be dismissed this way.
- Creation and decisions are authenticated, version checked, replay safe and audited with server actor/time.
- Failures remain visible and stale responses cannot attach an alert or acknowledgment to another customer.
- Synthetic tests assert existing clients, properties, appointments, payments and communication records remain byte-equivalent.

## Verification and recovery
Focused service, facade, synthetic browser and existing CRM/booking tests; ERP typecheck/build; Firebase syntax and transitive regression. Separate adversarial review before merge. Release only the new module and minimal facade addition against verified live source, preserving runtime configuration. No data migration; rollback UI/source retains internal records.
