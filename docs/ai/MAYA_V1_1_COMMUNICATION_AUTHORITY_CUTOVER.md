# Maya V1.1 Communication Authority Cutover Evidence

Status: **CLIENT PARITY STRUCTURALLY READY — SECURITY CUTOVER NOT AUTHORIZED**

Reviewed P0 source: `f70665fbb9dbae89d874e05beb0ca58705cb7385`.

## Objective

Separate two rollout questions that must not be conflated:

1. **Does ERP Next route critical Communication Center commands through the backend authority?**
2. **May Firestore Rules now remove the old direct-write compatibility path?**

Repository evidence answers the first question **yes for the reviewed ERP Next adapters**. The second remains **NEEDS_HUMAN** until the authority is deployed/verified in production and restrictive rules have emulator allow/deny evidence.

## Canonical client command path

`apps/erp-next/lib/communication-conversation-actions.ts` centralizes the production endpoint:

`https://us-central1-demac-corporation.cloudfunctions.net/communicationConversationAuthority`

Every command obtains the current Firebase web session and sends the ID token as Bearer authentication. The browser does not supply an authoritative actor role/name; the backend resolves the canonical active `users/{uid}` profile.

Covered command actions:

- `claim_conversation`
- `assign_conversation`
- `return_to_maya`
- `close_conversation`
- `reopen_conversation`
- `update_status`
- `mark_read`
- `send_reply`

The command adapter creates a stable per-attempt request ID and passes `expectedOwnershipVersion` where the ownership-sensitive command requires it.

## Communication Center adapter parity

`apps/erp-next/lib/browser-communications.ts` delegates critical mutations to the command adapter:

| ERP operation | Backend path |
| --- | --- |
| Claim conversation | `claimConversationCommand(..., ownershipVersion)` |
| Assign conversation | `assignConversationCommand(..., ownershipVersion)` |
| Return to Maya | `returnConversationToAiCommand(..., ownershipVersion)` |
| Resolve/close | `closeCommunicationConversation(..., ownershipVersion)` |
| Non-terminal status update | `updateConversationStatusCommand(..., ownershipVersion)` |
| Mark read | `markConversationReadCommand(...)` |
| Text reply | `queueWhatsAppTextCommand(...)` -> `send_reply` |
| Media reply | upload through authenticated `wacliOutboundMediaUpload`, then `sendCommunicationConversationReply(...)` |

Before guarded commands the adapter reads the current canonical `ownershipVersion` from `communicationConversations/{conversationId}`. A concurrent ownership transition therefore fails at the backend CAS instead of silently overwriting the current owner.

## Negative repository search

A focused repository search found no ERP Next code path that directly creates `whatsappOutboundQueue` records as an alternative to the command adapter and no `saveFirestoreDocument` mutation path targeting `communicationConversations` for the critical ownership/send operations reviewed here.

This is repository evidence, not proof of the currently deployed browser bundle. Live parity must still be verified after the matching ERP/function revisions are deployed.

## Backend authority invariants

`communicationConversationAuthority`:

- verifies Firebase ID token;
- requires an existing canonical `users/{uid}` profile;
- requires `active === true` and an allowed canonical communication role;
- validates ownership version for guarded actions;
- performs ownership transitions transactionally;
- records bounded command receipts/history for idempotency/audit;
- creates human outbound messages as deterministic `conversation_human` queue envelopes;
- rejects free-form human sends unless the conversation remains human-owned.

## Current Firestore compatibility bypass

The existing Firestore Rules still permit operations users to:

- update a limited set of `communicationConversations` ownership/status fields directly;
- create `whatsappOutboundQueue` documents when `status == 'queued'`;
- update generic `businessSettings` documents.

These rules predate the unbypassable backend authority model and must not be interpreted as a second intended authority.

## Security cutover gate

Do not restrict those Rules merely because repository adapters look correct.

Required evidence before a rules change can be approved:

1. `communicationConversationAuthority` is deployed and ACTIVE from the approved source revision;
2. unauthenticated, inactive-profile and unauthorized-role probes fail;
3. an authorized operator can claim/assign/return/close/status/read/send through the production ERP/API path;
4. stale `ownershipVersion` fails closed;
5. text and media sends create the correct governed outbound envelope;
6. no intended Communication Center action requires the direct Firestore compatibility writes;
7. emulator tests prove the proposed restrictive rules allow required reads/derived non-critical writes and deny the retired critical direct writes;
8. an explicit human approval authorizes the Firestore Rules/security cutover.

## Recommended restrictive-rule intent

This document does **not** contain an executable Rules patch. The future reviewed security change should be designed so that:

- client reads needed by authorized Communication Center operators remain available;
- critical conversation ownership/status transitions cannot be written directly by browser clients;
- browser clients cannot create `whatsappOutboundQueue` conversational envelopes directly;
- Maya pilot/voice/autonomy settings that affect production authority are not writable through a generic operations `businessSettings` rule;
- server-side Admin SDK authorities continue to write their canonical records.

The exact allowed settings/admin surface must be designed and emulator-tested rather than implemented as a broad deny that breaks unrelated ERP settings.

## B4 classification

- **B4a — ERP client parity (repository architecture): READY.**
- **B4b — deployed authority/live parity: OPEN.**
- **B4c — Firestore Rules/security cutover: NEEDS_HUMAN.**

No security rule, production endpoint, setting, queue item, or conversation was changed while producing this evidence.
