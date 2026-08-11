# ERP Next — Shell Productivity V1

## Global Search / Command Palette

- UX-SEARCH-001 — Global search is a real interactive control, not decorative UI.
- UX-SEARCH-002 — `Cmd/Ctrl + K` opens or closes the command palette.
- UX-SEARCH-003 — Current phase searches ERP modules and governed quick actions.
- UX-SEARCH-004 — Entity search (customers, work orders, invoices, assets) will use repository indexes after Firebase is connected.
- UX-SEARCH-005 — Escape closes the palette and selection navigates through ERP routes.
- UX-SEARCH-006 — Results remain role-filtered through the same navigation surface.

## Notification Center

- NOTIF-001 — Top-bar notification count opens an attention popover.
- NOTIF-002 — Critical, warning and opportunity items retain distinct visual priority in light/dark modes.
- NOTIF-003 — Notification items navigate to the relevant management module.
- NOTIF-004 — The complete source of truth remains the KPI/attention queue; the popover is a fast entry point.

## Settings preview persistence

- SET-006 — Test changes to service duration, deep-clean duration, operating buffer and overtime threshold can be explicitly saved as a browser draft.
- SET-007 — Browser draft survives refresh on the current device.
- SET-008 — Unsaved state is visible.
- SET-009 — Browser storage remains explicitly temporary and will be replaced by versioned Firebase settings + audit events.

## Current search limitation

The command palette currently searches application destinations and quick actions only. It intentionally does not pretend to search entity data until a real repository/index adapter exists.
