# Candidate publication rules — emulator fixtures, NOT deployed rules

These are the proposed website-editor rules from PR #513's reviewed implementation.
Every original allow/deny assertion still runs against them in the local demo emulators.
`firebase.json` does not reference these files. The deployed root `firestore.rules` and
`storage.rules` are restored byte-for-byte to the PR base so merging the UI does not
trigger or change their production rollout. No deploy job or approval check is disabled.

The production editor remains disabled. The protected publisher is not exported from
the operational functions bootstrap. A future separately reviewed publication rollout
must integrate current root rules (not blindly deploy these snapshots), reconcile the
canonical content, and address existing collection-wide businessSettings readers before
narrowing draft access. That compatibility work has been removed from this UI delivery;
Scheduling and Legacy readers retain their original implementations.

A passing candidate-rules test is not evidence that these rules are installed, that the
production publisher is active, or that the full feature is released. See RELEASE.md
and REVIEW.md for the actual stage and blockers.
