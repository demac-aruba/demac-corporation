# Approved message editor frontend release

Owner approved merge and deployment of PR #610. Its main integration and controlled
backend release are preserved on main. This frontend release is based on the exact
active production commit `3b6d66bcf45d3c7b873ba7b27e1647c534a515f1`, which includes
the already published one-step payment form from PR #614.

Apply only the ten reviewed editor frontend/shared-composer files from original
feature commit `38533a88da1bf7367e94d6a79611205d54ac5383`. The navigation delta is
one administrator-only System item. All editor/composer/catalog source bytes are
identical to the approved feature. No runtime dependency, backend export, settings,
sender, receipt/payment code, security rule or production-data change is included.
The independently pending messaging monitor frontend is not activated by this release.

Separate Solo Maintainer Adversarial Review: compare the complete diff to the active
production baseline and the approved feature; verify only those ten files plus this
review change. Main's other approved work is not reverted or deleted. This PR merges
into a production snapshot branch, not main. CI/preview must pass on this exact head.
Production deployment is authorized only after the controlled API/eight-producer
workflow passes on the latest reviewed main SHA. Use a production rebuild of this
ready preview with `withLatestCommit=false`; verify source SHA and domains afterward.

The feature's actual component browser checks and 171 backend checks are recorded
in main's message-template-editor review. This release additionally checks types,
build and source isolation on the current payment-enabled production baseline.
No administrator impersonation or test messages are permitted. Verify available
production access honestly and report any signed-in acceptance limitation.
