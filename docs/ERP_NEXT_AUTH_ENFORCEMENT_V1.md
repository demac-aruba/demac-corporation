# ERP Next — Mandatory Authentication Enforcement V1

## Objective

Remove the rebuild-only Preview Owner fallback and make DEMAC ERP fail closed. No internal ERP module may render unless the browser has a valid Firebase-authenticated session tied to an explicitly provisioned, enabled DEMAC `users/{uid}` profile.

## Access rules

- `/login` is the public entry surface.
- Every route under the ERP route group is wrapped by `AuthGate`.
- Missing session → redirect to `/login`.
- Invalid/expired session → clear session and redirect to `/login`.
- Missing Firebase client configuration → ERP remains locked.
- Firebase Authentication account without a `users/{uid}` ERP profile → denied.
- ERP profile with `active !== true` → denied.
- Missing/unrecognized ERP role → denied.
- Sign-out clears the Firebase web session and returns directly to `/login`.
- There is no Preview Owner / guest / anonymous access path.

## Existing DEMAC account compatibility

Legacy DEMAC managed users already use Firebase Authentication plus `users/{uid}` profiles with `role` and `active` fields. Legacy roles are normalized as follows:

- `admin` → `super_admin`
- `office` → `office_operator`
- `supervisor` → `operations`
- `technician` → `technician`
- `accounting` → `finance`
- `inventory` → `warehouse`

Additional ERP Next aliases remain supported where explicitly recognized.

Passwords are never read from Firestore or stored in ERP Next code. Firebase Authentication verifies the password.

## Privacy hardening

ERP metadata now sends `noindex`, `nofollow` and `nocache` robot directives. This is privacy hardening only; authentication remains the actual access control.

## Current session model

The browser Firebase session remains stored in `sessionStorage`, consistent with the existing ERP Next authentication adapter. This means browser tabs/sessions do not receive a permanent anonymous fallback when a session disappears.

## Data-layer protection

Existing Firestore Security Rules already require an authenticated, active `users/{uid}` profile for ERP collections. The UI gate is therefore aligned with the existing Firebase data authorization model rather than replacing it.

## Security follow-up

Before production data migration, continue reviewing server-side/API endpoints individually so every sensitive operation verifies authenticated identity and role/capability independently of the UI.