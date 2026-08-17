// Marketing Creative Builder production adapter.
// V2.1 uses the current GPT Image 2 edits API directly and intentionally does
// not send legacy input_fidelity parameters. Keep this adapter path stable so
// existing bootstrap/deployment wiring can move forward without changing the
// public callable names used by ERP NEXT.
module.exports = require('./marketingCreativeBuilderV21');
