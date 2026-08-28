function nonNegativeEpoch(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function positiveEpoch(value) {
  const normalized = nonNegativeEpoch(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function communicationEpochDecision({
  conversation = {},
  expectedOwnershipVersion,
  expectedCustomerInputVersion,
} = {}) {
  const expectedOwnership = nonNegativeEpoch(expectedOwnershipVersion);
  const expectedInput = positiveEpoch(expectedCustomerInputVersion);
  const currentOwnership = nonNegativeEpoch(conversation.ownershipVersion);
  const currentInput = positiveEpoch(conversation.customerInputVersion);

  if (expectedOwnership === null) {
    return { allowed: false, reason: "expected-ownership-version-missing" };
  }
  if (expectedInput === null) {
    return { allowed: false, reason: "expected-customer-input-version-missing" };
  }
  if (currentOwnership === null) {
    return { allowed: false, reason: "current-ownership-version-missing" };
  }
  if (currentInput === null) {
    return { allowed: false, reason: "current-customer-input-version-missing" };
  }
  if (expectedOwnership !== currentOwnership) {
    return {
      allowed: false,
      reason: "ownership-version-changed",
      expectedOwnershipVersion: expectedOwnership,
      currentOwnershipVersion: currentOwnership,
    };
  }
  if (expectedInput !== currentInput) {
    return {
      allowed: false,
      reason: "customer-input-version-changed",
      expectedCustomerInputVersion: expectedInput,
      currentCustomerInputVersion: currentInput,
    };
  }
  return {
    allowed: true,
    reason: "communication-epochs-current",
    ownershipVersion: currentOwnership,
    customerInputVersion: currentInput,
  };
}

module.exports = {
  communicationEpochDecision,
  nonNegativeEpoch,
  positiveEpoch,
};
