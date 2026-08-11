# ERP Next — Authentication & Session V1

## Objective

Introduce real Firebase-authenticated identity and role-aware ERP navigation without locking DEMAC out of the live rebuild before Firebase Security Rules and production data mode are approved.

## Modes

### Preview Owner Mode
- default fallback during the rebuild
- full product-review navigation for the owner
- structured/browser test data only
- explicitly **not** treated as authenticated production access

### Firebase Authenticated Mode
- uses Firebase email/password authentication
- loads the authenticated user's `users/{uid}` profile
- normalizes legacy role names into ERP Next roles
- applies the role/capability menu dynamically
- session token is kept in browser `sessionStorage`
- session automatically returns to Preview mode if the stored Firebase session is no longer valid

## Login surface

`/login` provides:
- Firebase configuration readiness state
- authorized email/password sign-in when configuration is detected
- safe Preview Owner fallback
- no forced login until real-data mode is activated

## Shell behavior

- sidebar navigation is now filtered by the effective authenticated role
- command-palette destinations are filtered by the same role
- quick actions are removed when the role cannot access the destination
- management notifications are hidden when their target module is not accessible
- account chip exposes session/security mode
- Firebase users can sign out back to Preview mode

## Role safety

Unknown legacy role strings map to the read-only `auditor` role rather than broad office access.

Known aliases include:
- `owner`, `admin` → `super_admin`
- `manager`, `operations` → `operations`
- `office`, `operator` → `office_operator`
- `accounting` → `finance`
- `inventory` → `warehouse`
- `projects` → `project_manager`
- `tech` → `technician`
- `readonly` → `auditor`

## Important limitation

Preview mode remains intentionally open while the rebuild contains no real operational dataset. Before any Firebase production data is enabled, authenticated access plus Firestore Security Rules must become mandatory for the relevant data paths.
