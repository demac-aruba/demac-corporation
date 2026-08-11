# ERP Next — Per-User Accessibility Text Size V1

## Objective

Allow every ERP user to enlarge operational/supporting text without changing DEMAC's approved visual structure or requiring an administrator to edit CSS.

## Approved default

`Standard` is the current approved ERP typography baseline, including the Scheduling readability increase accepted on Aug 11, 2026.

## User options

- Standard / +0 px
- +1 px
- +2 px
- +3 px
- +4 px maximum

Each step adds the selected number of pixels to eligible operational/supporting text relative to the current designed baseline.

## Guardrails

- H1, H2 and H3 page-heading sizes are never modified by this preference.
- Maximum enlargement is +4 px to protect information density and layout integrity.
- Grid structure, cards, four-van Scheduling layout, business logic and workflows are unchanged.
- Preference is personal, not role-wide or company-wide.
- One employee changing text size never changes another employee's preference.
- Accessibility does not require permission to change governed business settings.

## Access

The full control is shown in **System Settings → My Preferences → Accessibility** for users who can access System Settings.

Every authenticated/preview user also has the same personal control in the account/session popover, so technicians and operators do not need administrator permissions to improve readability.

## Current persistence

V1 stores the preference by `principal.userId` in browser storage:

`demac.erp-next.user-preferences.{userId}.v1`

The preference automatically reloads for that user on the same browser/device.

## Production migration

When production user-profile persistence is enabled, the same `textSizeOffset` field should move to the authenticated User Preference/Profile repository so the preference follows an employee across devices. Browser persistence remains a safe fallback/cache, not the final cross-device source of truth.

## Implementation behavior

ERP Next captures each eligible element's designed/computed font size and adds the user's selected offset at runtime. H1/H2/H3 descendants and elements explicitly marked `data-demac-text-scale="ignore"` are excluded.

Dynamic UI elements are observed so menus, drawers, modals and workflow records created after initial page load receive the same accessibility preference.
