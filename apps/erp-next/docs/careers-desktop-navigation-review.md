# Careers desktop and native navigation correction — preview only

Delivery mode: Fast Product Validation. Owner requested correction of oversized desktop fact icons and genuine browser Back/Forward, without plain text return links. Branch: feature/careers-funnel-preview. No merge or production deployment.

## Evidence and scope

The existing public shell has `.public-site svg { width:100%; height:100% }`. Previous compatibility CSS scoped only selected button/label children, leaving fact-card icons affected by stylesheet order. The new sizing rule targets every explicitly marked Careers icon, independent of shared CSS order. Fact cards use a fixed icon column and a flexible text column. Shared global CSS and components are unchanged.

The former root switched React view state without adding history entries. The replacement uses supported native History API integration with Next: distinct query URLs for role, application stage, review, receipt and entry into Recruitment. It reads popstate, normalizes deep links against the current in-memory draft, preserves browser Forward, and restores scroll/focus for entries. Only route identifiers go into history.state; drafts, file blobs, names, email and phone remain in memory. Initial routing replaces, rather than pushes, to avoid an artificial Back trap.

Back controls in public position/application screens are circular SVG buttons with accessible labels, tooltips, visible focus and 46px targets. Existing role-specific validation and preview-only persistence boundaries are preserved. Completed preview applications remain read-only when revisited through browser history and confirmation re-entry does not create duplicates.

## Validation

Existing visual/workflow acceptance checks are retained with the updated version marker and per-screen icon bounds. Additional regression script measures each fact card's icon and text bounds (not just page overflow), injects the shared illustration rule after module CSS, exercises native Back/Forward and the icon controls, verifies form/photo/CV retention, direct role links, refresh and invalid-step recovery. Chromium includes 1649px matching the owner's screenshot, 1920px, 1024px and mobile widths; WebKit and Firefox are also included. See the actual CI run/artifacts before declaring PASS. Emulation is not real Apple/Windows/Galaxy device certification.

No live Firebase, email, scheduling, CRM, Projects or Maya write paths are changed. Backend tab/editor navigation remains its existing preview behavior; the current focused fix covers the public Careers journey plus entering/leaving recruitment. No new recruiting source of truth is created.

Primary implementation references: https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api and https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API .
