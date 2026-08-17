// Production wrapper for Creative Engine V4.
// The V4 intelligence/render pipeline remains unchanged. After it finishes,
// an independent visible-copy gate audits every rendered variant before the
// callable returns to ERP. This is a correctness/safety layer, not V4.1 art direction.

const { HttpsError, onCall } = require('firebase-functions/v2/https');
const v4 = require('./marketingCreativeBuilderV4');
const { openAiApiKey } = require('./marketingCreativeProvidersV3');
const { auditCreativeRecord } = require('./marketingCreativeCopyGateV4');

function safeString(value, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function runUnderlyingV4(request) {
  const callable = v4.requestMarketingCreativeBuild;
  if (!callable || typeof callable.run !== 'function') {
    throw new HttpsError('internal', 'Creative Engine V4 callable does not expose an internal run handler.');
  }
  return callable.run(request);
}

exports.requestMarketingCreativeBuild = onCall({
  region: 'us-central1',
  timeoutSeconds: 900,
  memory: '2GiB',
  secrets: [openAiApiKey],
}, async (request) => {
  const result = await runUnderlyingV4(request);
  const creativeId = safeString(result?.creativeId, 220);
  if (!creativeId) throw new HttpsError('internal', 'Creative Engine V4 returned no creative id for copy audit.');
  try {
    const audited = await auditCreativeRecord(creativeId);
    return {
      ...result,
      status: audited.status,
      imageUrl: audited.imageUrl,
      qa: audited.qa,
      selectedVariantId: audited.selectedVariantId,
      variantCount: Array.isArray(audited.variants) ? audited.variants.length : result.variantCount,
      copyAuditVersion: audited.copyAuditVersion,
      copyAuditSummary: audited.copyAuditSummary,
    };
  } catch (error) {
    const message = safeString(error instanceof Error ? error.message : String(error), 1000) || 'Independent copy gate failed.';
    console.error('Creative Engine V4 independent copy gate failed', error);
    throw new HttpsError('internal', `Creative rendered, but exact-copy verification could not complete: ${message}`);
  }
});

exports.approveMarketingCreative = v4.approveMarketingCreative;
// Preserve the production CI contract used by the Marketing Agent workflow.
exports.__marketingCreativeBuilderV4Test = v4.__marketingCreativeBuilderV4Test;

exports.__marketingCreativeBuilderV4GuardedTest = {
  runUnderlyingV4,
  hasUnderlyingRun: typeof v4.requestMarketingCreativeBuild?.run === 'function',
  builderVersion: v4.__marketingCreativeBuilderV4Test?.BUILDER_VERSION,
};
