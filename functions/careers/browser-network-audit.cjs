'use strict';
// Evidence classification only: never intercept or alter application requests.
// Next 16 static exports resolve HEAD metadata before fetching __next._tree.txt.
// Chromium can emit ERR_ABORTED for a successfully consumed bodyless HEAD. Count
// it as metadata completion ONLY if this same phase completed the real route-tree
// GET. Missing headers, rejected requests, API/asset failures stay failures.
function auditNetworkEvents(failed, completed, site) {
  const metadataCompletions = [], failures = [];
  for (const event of failed) {
    const treePath = `${event.path.replace(/\/$/, '')}/__next._tree.txt`;
    const consumedMetadata = event.origin === site && event.method === 'HEAD'
      && event.type === 'fetch' && event.error === 'net::ERR_ABORTED'
      && event.response?.status === 200
      && /^text\/html(?:;|$)/i.test(event.response.contentType || '')
      && completed.some(next => next.phase === event.phase && next.origin === site
        && next.method === 'GET' && next.type === 'fetch' && next.path === treePath
        && next.response?.status === 200);
    (consumedMetadata ? metadataCompletions : failures).push(event);
  }
  return { metadataCompletions, failures };
}
module.exports = { auditNetworkEvents };
