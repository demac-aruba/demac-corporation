// Marketing Creative Builder production adapter.
// Keep this stable adapter path so existing bootstrap/deployment wiring and the
// public callable names used by ERP NEXT do not change while the internal
// creative engine evolves. V4Guarded adds an independent exact-copy hard gate
// after rendering without changing the V4 creative intelligence pipeline.
module.exports = require('./marketingCreativeBuilderV4Guarded');