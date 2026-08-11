# ERP Next — Accessibility Text Size Fix V2

## Bugs fixed

1. Text-size preferences affected Settings / shell but did not reliably affect module pages such as Scheduling.
2. Switching repeatedly between +3 and +4 could visually compound text growth instead of treating each level as an absolute preset.

## Root cause

Scheduling and some other dense module surfaces use highly specific typography rules, including `!important` minimums. The first accessibility implementation attempted to recalculate and write numeric inline font sizes after every preference change. That approach could lose against module-level important rules and could re-measure already enlarged text as a new baseline.

## V2 contract

- Standard = +0 px.
- Level 1 = +1 px.
- Level 2 = +2 px.
- Level 3 = +3 px.
- Level 4 = +4 px.
- Levels are absolute presets; they never add to one another.
- H1 / H2 / H3 and their descendants are excluded.
- `data-demac-text-scale="ignore"` can exclude a special element when required.
- The preference is still keyed by authenticated ERP `userId`.

## Implementation

Every readable text element receives one immutable CSS baseline and an inline important rule of the form:

`font-size: calc(<baseline>px + var(--demac-accessibility-text-offset, 0px)) !important`

Changing the preference changes only the global CSS custom property:

`--demac-accessibility-text-offset: 0px | 1px | 2px | 3px | 4px`

Because the baseline itself does not change, +3 → +4 → +3 → +4 always produces exactly +3 / +4 and cannot compound.

Newly mounted route content is measured with the global offset temporarily neutralized to 0 px, then instrumented against its true module CSS baseline. This allows Scheduling, CRM, Work Orders, Field, Finance and dynamically mounted dialogs/menus to follow the same preference even when their local CSS uses `!important`.

Responsive re-baselining occurs after browser resizing so module-specific responsive typography remains the baseline before the user's accessibility offset is reapplied.
