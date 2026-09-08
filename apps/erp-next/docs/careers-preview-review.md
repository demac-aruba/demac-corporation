# Careers integrated preview — owner review; no merge

## Review V2

Owner supplied real Samsung screenshots and the original visual concepts. The requested change is a premium visual refinement of the existing Next Careers preview, not another HTML prototype and not production activation.

Delivery mode: Fast Product Validation. Branch: `feature/careers-funnel-preview`.

- Preserve existing PublicHeader, PublicBrand, PublicFooter, global website typography and DEMAC palette.
- Use circular connected steps with a dark current state and checked completed states.
- Add real SVG role metadata icons and a 2x2 facts grid on mobile. Never invent minimum experience; show the configured requirements.
- Move Apply now to a bottom role action area; simplify document preparation copy.
- Compact document cards, recent photo preview, file-type icons and green checks labelled as selected for review, never server upload/scanning certification.
- Separate general document file selection from camera capture. Omit accept/capture on the general supporting-file input to avoid forcing a media-only picker on mobile. Existing extension and size validation remains unchanged. Native picker must still be verified on Galaxy/iPhone hardware.
- Compact preview ribbon with collapsible review tools; test status remains visible.
- Compact review, reference/email receipt and explicit no-email-sent confirmation.
- Refine existing recruitment card spacing, tabs, photos, files and notes without new operational actions.

## Boundaries

No changes to main, Scheduling, CRM, Maya, other operational components, Firebase settings/rules, auth, secrets, production data, deployment configuration or email delivery. No candidate data is persisted or transmitted by Careers. Test applications remain in memory in the tab. Existing production-build gate remains unchanged.

The branch workflow only builds/tests; it does not deploy production or access secrets. It retains only fictional QA fixtures. It runs the actual Next static output in Chromium, WebKit and Firefox, with desktop/mobile viewport coverage and blocked external traffic. `apps/erp-next/scripts/careers-visual-acceptance.cjs` records the exact assertions and screenshots. Browser emulation must not be described as testing a real Apple or Samsung device. Do not claim tests passed until the workflow result is inspected.

Vercel Git integration creates the Preview deployment from this branch. Confirm READY and inspect the exact SHA before sharing the preview URL. No merge or production deployment until Christian approves.
