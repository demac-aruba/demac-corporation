# Unified property editor — adversarial self-review

Mode: Solo Maintainer Review; this is a separate adversarial pass by the implementing maintainer, not an independent review. Scope is the owner's approved property-editor mockup and subsequent main-office/text-size requirements on the existing isolated-preview branch.

## Authority and complete-diff review

Reviewed the new editor, draft projection, icons/styles/focus hook, CRM callbacks, Scheduling create/edit callers, shared API adapters, extracted location transaction planner and all three parent write paths. Replaced active ERP Next forms have no remaining callers; no Legacy Expo code was retired. Existing authority, role, Firebase rule, communications, booking capacity, equipment ownership and billing boundaries are unchanged.

The editor uses the same Property identity and child collections established by ADR-20260921. `main_office` is an additive dwelling type. Creation and editing submit property fields and explicit unit/area changes in one Firestore transaction. All relationship reads precede writes, including contact validation. Unit codes remain property-local; IDs are stable when names or types change. Saving counts cannot delete persisted units, move areas or classify historical equipment. Only changed units are submitted, preserving unchanged inventory in large properties. Existing create callers without locations retain their contract.

## Challenges and corrections

- Concurrent identical creation exposed a transaction-retry bug: the outer result object retained a tentative location version. Creation now prepares against version zero until the parent exists, then replays the existing record. The real-emulator race test passes.
- Lost responses can occur after commit. The UI locks the exact pending payload and request ID until a retry recovers the result. Browser interception deliberately committed creation and dropped its response; the retry produced one property and five units. Offline edit before commit is also covered.
- Invalid duplicate codes, foreign contacts/areas, stale versions and competing parent edits reject the entire transaction. Parent names/addresses cannot commit separately from rejected unit changes. Added real-emulator assertions compare saved parent/child state after rejection.
- The shared accessibility provider deliberately excludes H1–H3. New editor headings reference its same offset variable directly, while controls/supporting copy use the existing observer. No global provider or unrelated typography contract was changed. Actual Settings Standard/+4 measurements were 20/24px title, 14/18px section heading, 12/16px subtitle, 13/17px input and 11/15px label; reopening does not compound offsets.
- Mobile inspection found the isolated-preview notice could overlap the footer. The editor reserves that notice's height only in the synthetic preview and keeps the footer visible while its body scrolls. Select arrows and spacing were checked in the compiled UI.
- Focus filtering now respects controls disabled through a parent fieldset, including the uncertain-save state. Dialog closing is blocked until the pending result is recovered.
- Existing customer duplication is a known local validation rejection, so it does not incorrectly lock an unsubmitted draft as an unknown outcome.

## Verification

- ERP Next TypeScript check and optimized isolated build, including required prebuild suites.
- 549 relevant backend regression tests; 11 real Firestore emulator scenarios (four new unified-editor cases plus seven existing integrity scenarios).
- CRM and live Scheduling acceptance; Firebase syntax validation.
- 26 Chromium/WebKit project-budget browser scenarios with the real booking drawer and unchanged assertions. The adapter rejects unexpected property edits explicitly.
- Real compiled CRM: create complex/office/three apartments/annex, contact and access assignment, lost-response recovery, stable-ID rename, area creation, reload, preserved residence/main house and unclassified equipment.
- Real Settings typography on desktop and 390px mobile; dark mode; no browser exceptions or external requests in the editor test.
- Pixel 7/Chromium and iPhone 13/WebKit emulation: 40-unit search, unified customer+first-property creation, second property and annex editing in Scheduling, explicit visit selection, preserved service/van/instructions and persistence in a separate browser session.
- Real desktop booking: explicit dwelling/requester/access selection and two service units without equipment, canonical confirmation and normal return to the agenda. Existing Field/booking tests protect destination history.

## Decision and limits

Pass for isolated preview review. Keep PR draft and production activation blocked on the separately required owner approval. No real-data migration, production secret/rule/config change, merge, external message or invoice was performed. Physical devices were not available; mobile evidence uses browser/device emulation. The temporary tunnel requires the host to remain awake. Existing saved units cannot be removed by lowering counts; archival/deletion needs its own deliberate history-preserving workflow.
