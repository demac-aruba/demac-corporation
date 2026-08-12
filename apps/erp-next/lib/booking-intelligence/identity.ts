export type CustomerIdentityDraft = {
  name?: string;
  phone?: string;
  email?: string;
};

export type CustomerIdentityCandidate = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  status?: string;
  phoneShared?: boolean;
  previousPhones?: string[];
};

export type IdentityMatchStrength = 'high' | 'medium' | 'low';
export type IdentityRecommendedAction = 'reuse' | 'review';

export type CustomerIdentityMatch = {
  customerId: string;
  score: number;
  strength: IdentityMatchStrength;
  recommendedAction: IdentityRecommendedAction;
  reasons: string[];
  matchedCurrentPhone: boolean;
  matchedHistoricalPhone: boolean;
};

export function normalizeIdentityText(value?: string) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEmailKey(value?: string) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Booking Intelligence phone key.
 * Aruba local numbers are seven digits; normalize them to country code 297.
 * Explicit international numbers remain international. This keeps matching
 * deterministic without making the ERP UI depend on the legacy app bundle.
 */
export function normalizePhoneKey(value?: string) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const explicitInternational = raw.startsWith('+') || raw.startsWith('00');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (explicitInternational) return raw.startsWith('00') ? digits.slice(2) : digits;
  if (digits.length === 7) return `297${digits}`;
  if (digits.length === 10 && digits.startsWith('297')) return digits;
  return digits;
}

function levenshtein(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, row) => [row]);
  for (let column = 1; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

function nameSimilarity(left?: string, right?: string) {
  const a = normalizeIdentityText(left);
  const b = normalizeIdentityText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);
  const common = aTokens.filter((token) => bTokens.includes(token)).length;
  const tokenRatio = common / Math.max(aTokens.length, bTokens.length, 1);
  const compactA = a.replace(/\s/g, '');
  const compactB = b.replace(/\s/g, '');
  const editRatio = 1 - levenshtein(compactA, compactB) / Math.max(compactA.length, compactB.length, 1);
  return Math.max(tokenRatio, editRatio);
}

export function resolveCustomerIdentity(
  draft: CustomerIdentityDraft,
  candidates: CustomerIdentityCandidate[],
): CustomerIdentityMatch[] {
  const phoneKey = normalizePhoneKey(draft.phone);
  const emailKey = normalizeEmailKey(draft.email);
  const draftName = normalizeIdentityText(draft.name);

  return candidates.flatMap((candidate): CustomerIdentityMatch[] => {
    const reasons: string[] = [];
    let score = 0;
    const currentPhoneKey = normalizePhoneKey(candidate.phone);
    const historicalPhoneKeys = (candidate.previousPhones ?? []).map(normalizePhoneKey).filter(Boolean);
    const matchedCurrentPhone = Boolean(phoneKey && currentPhoneKey && phoneKey === currentPhoneKey);
    const matchedHistoricalPhone = Boolean(phoneKey && historicalPhoneKeys.includes(phoneKey));
    const emailExact = Boolean(emailKey && normalizeEmailKey(candidate.email) === emailKey);
    const similarity = draftName ? nameSimilarity(draftName, candidate.name) : 0;

    if (matchedCurrentPhone) {
      score += candidate.phoneShared ? 78 : 100;
      reasons.push(candidate.phoneShared ? 'Same current phone, marked as shared' : 'Exact normalized phone / WhatsApp match');
    }
    if (matchedHistoricalPhone) {
      score = Math.max(score, 58);
      reasons.push('Phone appears in this customer’s previous-number history');
    }
    if (emailExact) {
      score += matchedCurrentPhone ? 18 : 96;
      reasons.push('Exact email match');
    }
    if (similarity === 1) {
      score += Math.max(0, matchedCurrentPhone || emailExact ? 8 : 72);
      reasons.push('Exact normalized customer name');
    } else if (similarity >= 0.82) {
      score += Math.max(0, matchedCurrentPhone || emailExact ? 5 : 55);
      reasons.push('Very similar customer name');
    } else if (similarity >= 0.68 && (matchedCurrentPhone || emailExact || matchedHistoricalPhone)) {
      score += 3;
      reasons.push('Customer name is compatible with stronger identity evidence');
    }

    score = Math.min(120, score);
    if (score < 50) return [];
    const reusable = score >= 90 && !candidate.phoneShared && !matchedHistoricalPhone;
    const strength: IdentityMatchStrength = score >= 90 ? 'high' : score >= 65 ? 'medium' : 'low';
    const recommendedAction: IdentityRecommendedAction = reusable ? 'reuse' : 'review';
    return [{
      customerId: candidate.id,
      score,
      strength,
      recommendedAction,
      reasons,
      matchedCurrentPhone,
      matchedHistoricalPhone,
    }];
  }).sort((left, right) => right.score - left.score || left.customerId.localeCompare(right.customerId));
}