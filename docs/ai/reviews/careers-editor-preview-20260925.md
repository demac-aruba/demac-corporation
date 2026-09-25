# Careers: real candidate components from the unsaved editor

## Scope
Original V4 requirement: preview the current vacancy and question flow in both languages
without publishing, requiring SMTP, or discarding the editor. Existing Recruitment and
its labelled in-memory preview share EditorialPanel, so the control lives there.

## Boundary
This is a native modal with a detached editorial copy, not a new portal, source of truth,
or replacement for hosted persistent staging. It uses the existing VacancyProfile,
ApplicationFunnel and ApplicationReceipt. The authoritative public router is untouched.
The simulated candidate state is memory-only and discarded on close. The actual editor
values, source review status and canonical IDs are unchanged. A complete Spanish draft
may be rendered locally before approval; that projection never reaches a save callback.
Incomplete Spanish remains disabled. No auth/session/file/mail API is imported or called.

## Adversarial self-review (Solo Maintainer, not independent)
React portal events still bubble through the React tree. The modal must stop submit
propagation so Continue/Enter cannot submit the surrounding real administrative editor.
The portal places the trial form outside the editor form in the DOM. Native showModal
provides modal focus behavior and Escape closes only the trial. Native file inputs stay
available, without any upload transport. Locale switching is local, not a preference or
application metadata write. Closing/reopening clears only simulated candidate answers.

Primary API references used: https://react.dev/reference/react-dom/createPortal and
https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal .
No configuration, global styling, data migration, rule, secret or mail change is needed.

## Verification
Eight local projection/immutability/type-preservation tests passed, along with the local
Next typecheck and full isolated build (including existing prebuild gates).
System Chromium in this working container rejects localhost by administrator policy;
no attempt was made to change that policy. Local interactive validation is NOT RUN.
The new browser-editor-preview helper runs in the existing authorized Firebase CI
journey and must pass in Chromium and WebKit before this increment is declared verified.
It checks zero Careers API requests while previewing, exact editor retention, no source
approval, native modal semantics, no nested form, Enter/Continue isolation, language and
answer preservation, mobile overflow, and Escape/close/reopen. It records real screenshots.
The workflow also runs the new unit test; previous gates remain unchanged.

## Release boundary
Internal-mailbox copy is deferred by Christian. Real sender/scanner/privacy approval,
standalone authorized hero images, hosted persistent staging, physical-device testing,
and final owner visual/release approval remain explicit residual requirements.
Rollback: revert this preview-control increment coherently; no persistent data is changed.
