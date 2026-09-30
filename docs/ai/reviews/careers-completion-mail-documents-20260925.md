# Solo Maintainer review: candidate mail and category contracts

The implementer and reviewer are the same maintainer; this is not independent review.
Separate inspection covered the submit transaction, worker claims, infrastructure send,
public/preview consumers, legacy editor compatibility and private file lifecycle.

## Findings and treatment
- Frozen content is written in the existing atomic transaction; legacy queue rows are
  upgraded only on claim, not via migration. Sender credentials remain server-owned.
- Ambiguous send responses/expired leases stop automatic retries. Explicit SMTP reject
  and definite presend failures remain distinguishable; no exactly-once promise.
- Internal recipient is absent; no BCC or new recipients. Both recorded spellings require
  final owner confirmation when the deferred mailbox is created.
- Category affects byte-identity only for new specific kinds of supporting evidence;
  legacy generic IDs stay byte-for-byte compatible. Policy is checked at reserve and
  final submit, not only through visible UI controls.
- Original file array owns selected File identity; optional assignments supply category
  labels only. Unmatched removed assignments cannot add files to payloads or history.
- ID acceptance requires explicit server policy approval; draft configuration is not
  approval. Existing private scanner/lease/generation/recovery behavior is retained.
- Custom Spanish document help is used only against its explicitly reviewed source.
- Prepared HTML is escaped and displayed in a sandboxed iframe with no remote assets;
  no HTML answer execution, image tracking or downloaded applicant documents.

## Verification status before push
159 targeted contracts PASS, zero failed/skipped, including existing form/editorial/
submitted-original contracts, 10 candidate-mail tests and 9 category tests. Typecheck
PASS. A local build first exposed an out-of-root dependency symlink; dependencies were
copied locally without changing code/config. The next build compiled successfully but
its subsequent Next TypeScript worker exceeded the execution timeout. Full build and
browser verification must therefore be taken from final-head CI, not claimed here.
No production or mailbox delivery was tested. Further review/CI findings belong in the
PR checkpoint. Coherent revert does not delete already saved applicant records.
