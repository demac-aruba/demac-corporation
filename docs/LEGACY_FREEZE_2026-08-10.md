# DEMAC ERP Legacy Freeze — 2026-08-10

The former Expo/React Native Web ERP is no longer the active product direction.

## Preservation policy
- Legacy source code, scripts, historical fixes, workflow knowledge, and business-rule learnings remain in Git history and the dedicated preservation branch.
- No real production/customer operating data needs to be migrated from Legacy at this cutover checkpoint.
- New product development targets DEMAC ERP Next.
- Legacy should receive no new feature work unless explicitly needed for historical recovery.

## Production direction
The existing Vercel-connected repository will now deploy `apps/erp-next` as the primary ERP experience. This avoids maintaining a separate staging project while preserving Legacy code for reference.

## Safety
This freeze does not delete Firebase projects, credentials, historical Git commits, documents, or business requirements. Production data integrations remain disabled in ERP Next until their controlled migration/integration checkpoints are completed.
