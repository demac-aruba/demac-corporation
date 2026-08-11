# ERP Next Production Cutover

## Goal
Promote `apps/erp-next` to the existing Vercel-connected production project without creating a second Vercel project.

## Deployment strategy
The repository root remains the Vercel project root, but root `vercel.json` delegates installation and build to `apps/erp-next` and serves that application's `.next` output.

## Legacy handling
Legacy source remains in Git and in the preservation branch. It is no longer the product served by the existing Vercel project.

## Data status
No real Legacy ERP production/customer data requires migration at this checkpoint. ERP Next persistence/integration layers remain intentionally disconnected until their dedicated implementation stages.
