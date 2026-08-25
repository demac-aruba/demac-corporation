# DEMAC WhatsApp wacli Bridge

Status: **current architecture guide; legacy runtime files remain in this folder only as superseded reference until the deployed host is independently verified.**

## Canonical runtime boundary

The current reviewed bridge implementation is:

- `ops/digitalocean/deploy/server-v2.mjs`

The current connector validation/deployment contract is:

- `.github/workflows/wacli-webhook-deploy.yml`
- `functions/whatsappWacliGateway.js`
- `functions/wacliCommunicationBoundary.js`
- `functions/wacliBridgeAccountBinding.test.js`

Do **not** deploy `services/whatsapp-bridge/server.mjs`, the environment example in this folder, or the `systemd/` files as the current bridge architecture. They describe an older Firebase-to-Droplet sender topology and are retained only so the previous deployment can be understood or recovered during an authorized migration review. Removing them requires evidence about the actual host and is therefore not performed automatically.

## Current topology

```text
WhatsApp linked device / wacli sync
        |
        | local signed webhook + media
        v
DigitalOcean bridge
ops/digitalocean/deploy/server-v2.mjs
        |
        | Authorization: Bearer <bridge token>
        | X-Demac-Communication-Account-Id: <explicit account>
        v
Firebase Communication connector
  - wacliWebhook
  - wacliMediaIngest
  - wacliOutboundPoll
  - wacliOutboundAck
        |
        v
Canonical Communication Center records
  - communicationConversations
  - whatsappMessages
  - whatsappOutboundQueue
```

Outbound delivery is **pull based** from the DigitalOcean bridge. Firebase no longer pushes customer/transactional commands to a public `/v1/send` endpoint. The retired `sendQueuedWacliMessage` Firebase-to-Droplet sender must not be reintroduced.

## Authority and configuration ownership

The bridge is a transport adapter, not a business source of truth. It must not decide customer intent, booking state, pricing, conversation ownership, or Maya policy.

The canonical WhatsApp communication-account configuration is owned by `businessSettings/whatsapp` and interpreted by `functions/demacCommunicationIdentity.js`. The bridge must assert the exact configured account on every Firebase connector request through `COMMUNICATION_ACCOUNT_ID` and `X-Demac-Communication-Account-Id`.

`ops/digitalocean/deploy/server-v2.mjs` fails startup when the required account binding or bridge credentials are missing. Firebase independently verifies the Bearer credential and account binding before accepting ingress, media, outbound poll, or outbound acknowledgement requests.

Do not copy a communication account ID into Booking, Technician, Maya, or other domain settings. Those domains consume the canonical Communication configuration through the approved transport/service boundary.

## Inbound contract

The bridge forwards provider events; Firebase owns canonicalization and persistence.

The canonical local identity is derived from:

`communicationAccountId + channel + provider + remoteConversationId`

Provider message identity is additionally scoped by the provider message ID. The same remote WhatsApp number on two communication accounts must therefore produce different local conversation/message identities.

The transport layer must not perform language/intent routing or operator assignment. New inbound communication enters the canonical Communication Center first; Maya Observation/Reply Policy and human ownership are evaluated in their respective governed layers.

## Outbound contract

All Wacli outbound commands use `whatsappOutboundQueue` through approved Communication services.

The bridge polls Firebase for commands scoped to its one `COMMUNICATION_ACCOUNT_ID`. Before a conversational Maya/human command can be claimed, Firebase revalidates the current sender/ownership epoch. Transactional notifications remain account-scoped but are intentionally independent from conversation ownership.

The bridge must reject a command returned for a different communication account and must acknowledge the exact claimed command back to Firebase.

## Media and voice

Original customer media remains canonical evidence. The bridge may transport/download media, but transcription is a derived server-side capability in Firebase. Customer voice auto-processing is governed separately by Maya voice eligibility, including the deliberate activation cutoff and no-historical-backfill rule.

## Validation

The repository quality gate for this boundary is the **WhatsApp wacli Connector** workflow. It validates the current `server-v2.mjs`, the Firebase gateway/boundary, account-binding tests, outbound media authorization, and rejects resurrection of retired Firebase-to-Droplet sender code.

A green pull-request validation does not deploy the bridge or change the host. The workflow's production deployment steps are restricted to the approved `main` push path; this documentation does not authorize a production deployment.

## Legacy files in this folder

The following are **superseded implementation artifacts**, not current deployment instructions:

- `server.mjs`
- `demac-whatsapp-bridge.env.example`
- `systemd/demac-whatsapp-bridge.service`
- `systemd/demac-wacli-sync.service`
- `package.json`

They currently remain because repository evidence alone does not prove which files are installed on the live DigitalOcean host. Deleting or replacing host files, changing environment variables, restarting services, rotating credentials, or changing the linked WhatsApp account is a production operation and requires explicit human approval.

## NEEDS_HUMAN before legacy removal or production activation

Before the legacy artifacts above can be deleted, an authorized operator must verify the live host is running the account-bound `server-v2.mjs` topology and record the installed service/environment source. Production activation also requires confirmation of the canonical corporate `communicationAccountId` and any other production-only Maya/voice activation settings required by the governing engineering specification.

Until that evidence exists, keep the legacy artifacts classified as superseded and do not use them for new deployments.
