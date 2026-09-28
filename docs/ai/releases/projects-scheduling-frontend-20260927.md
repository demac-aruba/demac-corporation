# Scoped Projects and Scheduling frontend release

The owner approved publishing the scoped Projects editor and historical Regular
Booking slot correction for live workflow testing. PR #535 was merged at
`cf577804b3ca081c7c3d3df6e1812c7a4f4d4690` with `[merge-only]`, so neither
frontend nor automatic backend jobs published on that merge.

The guarded backend release branch then advanced to
`83332590c50b8101990a447e4497bd76114feafd`, with a tree identical to the
merged main commit. [Project historical bookings run 36368235378](https://github.com/demac-aruba/demac-corporation/actions/runs/36368235378)
passed both historical acceptance and approved backend deployment. Its guard
compared the live Office and Project source with approved generations before
updating only `officeBookingAuthority` and `projectAuthority`, then verified both
were ACTIVE and rejected anonymous POST calls. Independent post-release checks
confirmed both endpoints return HTTP 204 to the production-origin CORS preflight,
allow POST and OPTIONS with Authorization and Content-Type, and return HTTP 401
to an anonymous POST.

This documentation-only, unmarked main commit triggers the normal production
Vercel builds for the two existing DEMAC projects. It makes no additional
application, Function, rule, migration, or customer-record changes. PR #514,
the Technician App, financial actuals, and billing remain outside this release.

After both deployments are READY, verify their production commit is this
documentation trigger, that `/projects/` and `/scheduling/` serve successfully,
and that the owner can inspect an existing Project and ordinary Scheduling flow
in an authenticated session. Test historical correction only on a genuinely
eligible record after checking that it has no Field or billing evidence; do not
create or modify a real customer record merely as a fixture. If production
behavior fails, stop new changes and use a reviewed forward fix. After a new
property-free Draft or historical correction has been saved, do not blindly
downgrade the backend to an older schema.
