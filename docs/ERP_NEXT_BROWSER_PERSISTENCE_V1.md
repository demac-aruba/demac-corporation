# ERP Next — Browser Persistence V1

## Purpose

Provide a real, refresh-persistent CRM test workflow on the live ERP before production Firebase persistence is enabled.

This is **not** the production database and must never be presented as multi-user/company-wide storage. It is a transitional test adapter for UX and workflow validation.

## Vertical slice enabled

- Customer identity
- Customer edit/create
- Contacts
- Properties / Sites
- HVAC Equipment / Assets

## Behavior

- Test records persist in the current browser using namespaced `localStorage` keys.
- Customer master records use one browser collection.
- Contacts/sites/assets are namespaced by internal customer ID.
- Newly created customers start with no fake property/equipment master data.
- Existing seeded demo customers keep their preview seed the first time they are opened.
- Browser storage failures never block the UI.
- Duplicate detection remains active for customer name, phone and email.

## Why this exists

The repository/persistence foundation is provider-neutral. This lets DEMAC validate the actual Customer → Contact → Site → Asset flow immediately while Firebase Auth/Firestore Security Rules are still being prepared.

## Replacement path

The browser adapter will be replaced by the Firebase repository adapter without changing the CRM information hierarchy:

`UI → Application Service → Repository Contract → Firebase Adapter → Firestore`

## Limitations

- Data is local to one browser/device.
- Clearing browser site data removes these test records.
- No multi-user concurrency.
- No company-wide synchronization.
- No server-side audit trail.
- No production use.

The live UI explicitly labels this state as **Browser-persistent test data · Firebase not connected**.
