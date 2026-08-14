# Marketing Agent V1C validation contract

V1C converts the ranked visual evidence produced by V1B into one structured advertising campaign strategy.

## Required behavior

- A Firebase-authenticated, active DEMAC `admin` or `office` user is required.
- Visual analysis must be completed before campaign strategy can run.
- Only V1B assets that completed analysis and are not marked `doNotUse` may be selected.
- The strategist may choose one hero image and up to four supporting images from that allowed set.
- Customer-facing copy is generated for Aruba in Papiamento (`pap_aw`).
- Unknown Papiamento words are checked against the Aruba vocabulary plus approved DEMAC corrections and trigger one automatic language revision pass.
- If uncertain words remain, the campaign is stored as `needs_review`; this is a blocking quality signal for later automatic rendering, not a silent approval.
- Prices, promotions, discounts, warranty claims, BTU, SEER, product specifications, stock, installation inclusions, testimonials, ratings, deadlines and scarcity claims must never be invented. They may only come from approved Brand Center facts.
- Real DEMAC work photos remain the primary visual evidence and must not be distorted.
- Every visual direction must reserve a sufficiently large blank bottom area for the original DEMAC company footer and must never recreate that footer.

## Authenticated smoke validation

A synthetic end-to-end test was executed against the Gen2 callable using a temporary Firebase Auth admin user, one synthetic analyzed hero asset and one supporting asset. It verified authentication, DEMAC role authorization, OpenAI strategy generation, Firestore persistence, hero/supporting selection, copy persistence, Papiamento validation state, commercial-fact guardrails and cleanup.

The test selected the top-ranked installation image as hero, retained the supporting technician image, included no price or promotion, and correctly returned `needs_review` when two generated words were not accepted by the Aruba vocabulary after the revision pass. All synthetic Auth and Firestore records were deleted after the test.
