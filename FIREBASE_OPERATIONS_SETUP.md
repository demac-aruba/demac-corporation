# Firestore operational data

The real-access mode stores operational records in Cloud Firestore.

## Collections

- `clients`: customer/contact and property information.
- `workOrders`: appointments, dispatch assignments, job status and technical report data.
- `users`: authenticated DEMAC staff profiles. The document ID must match the Firebase Authentication UID.

## User profile fields

Each authenticated user requires a document under `users/{uid}` with at least:

- `active`: `true`
- `role`: `admin`, `office` or `supervisor` to manage clients and work orders
- `name`
- `email`

## Security rules

Deploy `firestore.rules` to the Firebase project before testing real client and work-order creation.

```bash
firebase deploy --only firestore:rules --project demac-corporation
```

The application keeps Demo access local and separate. Firebase-authenticated users load only the real `clients` and `workOrders` collections and synchronize them every 30 seconds.
