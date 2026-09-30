# Careers completion: candidate acknowledgement and categorized documents

## Authority and latest instruction
Christian requested continuous work through the pending features. The independent
internal mailbox is expressly deferred until it exists. The latest utterance uses
`careers@dmacaruba.com`, while the original specification uses
`careers@demac-aruba.com`. Neither address is silently corrected, configured or sent
mail. No new real sender, live intake, migration, rule or production activation.

Deep Review: extend the existing Careers transaction, queue, private documents and
protected Recruitment; no new authority, no new provider. Base 19451b3e.

## Acceptance
- Candidate receipt HTML and plain text use frozen submitted locale, title and template;
  queue creation stays atomic and legacy jobs remain compatible.
- No contact details in logs or new public URLs; no documents or BCC in candidate mail.
- Rejection, presend failure and uncertain SMTP completion are distinct. No automatic
  resend after ambiguous acceptance. Preparation is not proof of inbox delivery.
- Supporting categories extend `kind=document`, preserving legacy keys and records.
  Total counts and byte/content/scanner/generation protections remain unchanged.
- Required categories validated in the form AND authoritative submit; unsupported and
  unapproved ID categories reject before a file reservation. No universal ID requirement.
- One configurable bilingual category editor, exact reviewed source for custom help,
  and shared candidate controls in public/preview. Original submitted job stores rules.
- In-memory previews remain explicitly in-memory. Internal mail is deferred, not claimed
  implemented by this slice. Production policy, scanner and sender remain separate gates.

## Verification plan
Retain all earlier checks and browser matrix. Add candidate worker/frozen message tests,
category negative/positive tests, authenticated browser authoring, Spanish certificate
upload, private persisted metadata and exact prepared message inspection. CI and visual
artifacts are required for the pushed head. No real SMTP in integration tests.
