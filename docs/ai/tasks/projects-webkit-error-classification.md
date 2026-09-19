# Bounded diagnosis: WebKit pageerror versus actual uncaught JavaScript

Owner authorized isolating the existing failure instead of continuing broad work/repeated
full suites. Deep Review remains applicable. No release, source-of-record, production
configuration or operational write is authorized by this diagnostic.

Evidence already retained from the five TLS runs: Playwright emitted access-control pageerror
messages, with web-inspector bootstrap frames, while DOM error and unhandledrejection listeners
recorded empty arrays. This is a lead, not proof of harmlessness. The pinned Playwright WebKit
adapter maps Console.messageAdded(level=error, source=javascript) into pageerror, without first
requiring a DOM uncaught exception. Compare its v1.57.0 wkPage.ts _onConsoleMessage implementation.

Add a plain-HTML diagnostic with two loopback HTTP servers, no ERP/Next/Firebase/session auth
or production URLs. Collect RAW pageerror, failed requests, DOM error/unhandledrejection and
caught rejections. Scenarios: pending same-origin fetch on reload, handled fetch on pagehide,
handled cross-origin denial, and positive thrown-error/unhandled-rejection controls. No
preventDefault, ignore list, error suppression, retry-until-green, or required-gate modification.

A successful diagnostic only validates the controls and records evidence; it is NOT Projects
acceptance. Analyze exact results before proposing any production change or changing a test
oracle. If only a subset reproduces, state that limitation rather than calling the entire
WebKit blocker resolved. Original full-UI failing gate remains blocking until separately closed.

The only local browser storage is test evidence in disposable contexts. No original customer
Project, token, Appointment, Work Order, stock, notification or database is read or written.
