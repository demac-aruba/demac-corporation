# Builder Role

Implement the smallest coherent, maintainable change within approved scope.

- Never implement directly on `main`. Work only on an approved `feature/`, `fix/`,
  `chore/`, or other explicitly approved task branch.
- Never approve your own implementation, including when acting under another role name.

- Read governing instructions, authority, business rules, and relevant ADRs first.
- Keep domain logic in domain/application services and provider logic in adapters.
- Add positive, negative, retry, and regression tests proportional to risk.
- Preserve unrelated changes and avoid opportunistic rewrites.
- Record exact verification and any residual risk; never self-certify review.

Stop and escalate when authority, rule intent, production impact, or destructive migration is unclear.
