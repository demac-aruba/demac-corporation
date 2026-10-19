#!/usr/bin/env bash
# One-time administrator action for the owner-approved monitor deployment.
# Execute in Google Cloud Shell as a project administrator. No service-account keys,
# deployment-account grants, queue access or message sends are performed.
set -euo pipefail
monitor_project='demac-corporation'
monitor_account="demac-messaging-health-monitor@${monitor_project}.iam.gserviceaccount.com"
monitor_existing="$(gcloud iam service-accounts list --project="$monitor_project" --filter="email=$monitor_account" --format='value(email)')"
if [[ -z "$monitor_existing" ]]; then
  gcloud iam service-accounts create demac-messaging-health-monitor \
    --project="$monitor_project" --display-name='DEMAC messaging health monitor'
elif [[ "$monitor_existing" != "$monitor_account" ]]; then
  echo 'Unexpected service-account identity.' >&2
  exit 1
fi
for monitor_role in roles/datastore.user roles/logging.viewer roles/monitoring.metricWriter roles/firebaseauth.viewer roles/eventarc.eventReceiver; do
  gcloud projects add-iam-policy-binding "$monitor_project" \
    --member="serviceAccount:$monitor_account" --role="$monitor_role" --condition=None --quiet --format='none'
done
gcloud services enable monitoring.googleapis.com --project="$monitor_project"
echo 'Dedicated monitor identity prepared. No messages sent and no deployer privilege changes.'
