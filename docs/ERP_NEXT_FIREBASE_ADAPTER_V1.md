# ERP Next — Firebase Adapter V1

Status: **Adapter built / production writes still disabled.**

## Objective

Reuse the proven Firebase Authentication + Firestore REST approach from Legacy while keeping ERP Next business logic behind provider-neutral repository contracts.

## Configuration compatibility

ERP Next prefers the new public build variables:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`

To avoid asking DEMAC to duplicate Vercel configuration, `next.config.ts` maps the existing Legacy `EXPO_PUBLIC_FIREBASE_*` values into those browser build variables when the new names are absent.

Firebase web-app configuration identifiers are public client configuration. Service-account credentials, private keys and other secrets are **not** part of this adapter and must never be bundled into the browser.

## Authentication

- Email/password sign-in uses Firebase Identity Toolkit REST.
- Firebase ID token + refresh token session model is preserved from Legacy.
- ERP Next stores the temporary authenticated session in browser `sessionStorage`, so refresh survives but closing the browser session clears the locally stored auth session.
- Token refresh happens before expiry.
- Unknown legacy role values fail toward the read-only `auditor` role instead of broad access.

## Firestore transport

- Firestore REST calls use the signed-in user's Firebase ID token.
- The Firebase ID-token path is intentionally used so Firestore Security Rules remain the authorization authority at the database boundary.
- No service-account OAuth token is used in browser code.
- Canonical `*At` / `*Until` ISO date-time fields are encoded as Firestore timestamp values.
- Generic get/list/save/update transport is available.
- Hard-delete transport is intentionally omitted from the ERP Next adapter foundation.

## Repository adapter

`FirebaseDocumentRepository<T>` implements the provider-neutral ERP `WriteRepository<T>` contract and adds:

- stable generated entity IDs
- `createdAt` / `updatedAt`
- `createdBy` / `updatedBy`
- optimistic stale-record check when an expected `updatedAt` is supplied

The first CRM repository slice is prepared for:

- customers
- contacts
- sites
- assets

A `FirebaseCustomerGraphRepository` can load the first Customer → Contact → Site → Asset vertical slice.

## Rules draft

`firebase/erp-next-firestore.rules.draft` is intentionally **not deployed**. It currently covers only:

- authenticated user profile lookup
- customer read/manage roles
- contact/site/asset read/manage roles
- creation audit fields
- immutable creation audit fields on update
- no hard delete
- deny-by-default for the rest of ERP Next

Before deployment it must be tested in the Firebase Emulator and reconciled with the actual production user-role documents.

## Current limitations

- No ERP Next login screen is enabled yet.
- No Firestore production collection writes are enabled from the live ERP.
- High-volume CRM queries still need indexed structured-query repositories rather than collection-wide filtering.
- Storage/evidence upload adapter is still pending.
- Audit Writer transaction integration is still pending.
- Firebase Rules and indexes have not been changed in Console.

## Next checkpoint

1. verify whether the current Vercel build detects the inherited Legacy Firebase public config
2. add ERP Next authenticated session/provider UI without forcing login if Firebase is not ready
3. test read-only user/profile connectivity
4. connect Customer → Contact → Site → Asset through the Firebase repositories
5. only then review/apply the Firestore Rules and required indexes
