# ADR: additive submitted presentation on the existing Careers application
Status: implemented on feature branch only; not a production migration.

`submissionSnapshot` schema 1 is evidence of the final review, created inside the
existing submit transaction after canonical profile/vacancy/privacy validation.
It is not another application or a separate source of recruiting truth.
`profile` stays canonical and compatible for contact, search and existing workers.
The snapshot's rows preserve the exact validated original values and frozen question/
option labels. Only visible configured question IDs and allowlisted standard fields
are copied. Unknown keys, notes, client-provided snapshots and secrets are excluded.

UI and server share versioned standard prompts/choices and reviewed role projection.
The browser supplies only explicit `localeAtSubmit` and `presentationVersion`, never
authoritative labels. A mismatched presentation version rejects without writes.
An update to fixed prompts/choices must bump the presentation version. Server rollout
precedes the frontend version in a separately approved release.
Unknown native OS/country display formatting is not claimed as captured: country codes
are retained explicitly. Policy body is the exact configured original, with unknown
language until reviewed policy metadata exists. Preview policy is explicitly synthetic.

New fingerprints include raw profile + locale + version. Earlier requests without
these extensions keep the profile-only fingerprint and no guessed language snapshot.
The existing session status/receipt returns the frozen language/title metadata for recovery,
not the current browser preference. Admin update writes only stage/notes, never evidence.
Future separate email work must consume the saved locale/evidence; this change does not
send or localize messages. Existing one-job semantics are unchanged in this block.

No production backfill: missing snapshot means unknown language / saved legacy record.
Rollback is a coherent code revert; retain all existing application records and evidence.

Technical constraints checked against Firebase transaction docs (reads before writes,
whole-transaction retry/atomic commit) and React plain text rendering; no new APIs used.
