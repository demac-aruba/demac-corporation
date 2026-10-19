const text = (value) => typeof value === 'string' ? value.trim() : '';

function locationSnapshotForMessage(order, appointment) {
  // Ad-hoc support can predate Work Order location snapshots. Only use the
  // already-loaded, linked Appointment; never infer a unit from today's catalog.
  const linked = text(order?.appointmentId)
    && text(order.appointmentId) === text(appointment?.appointmentId || appointment?.id);
  const snapshot = order?.locationSnapshot || (linked ? appointment.locationSnapshot : null);
  if (!snapshot || !(text(order?.dwellingId) || text(snapshot.dwellingId))) return null;
  if (text(order?.propertyId) && text(snapshot.propertyId)
    && text(order.propertyId) !== text(snapshot.propertyId)) return null;
  if (text(order?.dwellingId) && text(snapshot.dwellingId)
    && text(order.dwellingId) !== text(snapshot.dwellingId)) return null;
  return snapshot;
}

function distinctParts(values) {
  const seen = new Set();
  return values.flatMap((value) => text(value).split(' · ')).map(text).filter((part) => {
    const key = part.toLocaleLowerCase('en');
    if (!part || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' · ');
}

function localizedDwellingName(value, languageCode) {
  // Translate only generic numbered apartment labels, never street or custom names.
  const match = text(value).match(/^(?:apartamento|apartment|appartement)\s+(\d+[a-z]?)$/i);
  if (!match) return text(value);
  const label = { en: 'Apartment', es: 'Apartamento', nl: 'Appartement', pap: 'Apartamento' }[languageCode];
  return label ? `${label} ${match[1]}` : text(value);
}

function bookingLocationLabel(order, appointment, languageCode = 'es') {
  const snapshot = locationSnapshotForMessage(order, appointment);
  if (!snapshot) return '';
  // Allowlist destination text only. Access codes, private notes and contact
  // snapshots must never enter the customer-facing address parameter.
  const redundant = new Set([
    snapshot.dwellingName, snapshot.dwellingCode, snapshot.areaName,
    snapshot.propertyAddress, order?.address,
    'Propiedad principal', 'Main property', 'Primary property',
  ].map((value) => text(value).toLocaleLowerCase('en')).filter(Boolean));
  const propertyLabel = text(snapshot.locationLabel).split(' · ')
    .filter((part) => !redundant.has(text(part).toLocaleLowerCase('en'))).join(' · ');
  return distinctParts([
    propertyLabel,
    localizedDwellingName(snapshot.dwellingName, languageCode) || snapshot.dwellingCode,
    snapshot.areaName,
  ]);
}

function bookingMessageAddressLines(order, fallbackAddress = '', { appointment, languageCode = 'en' } = {}) {
  // Preserve the existing notification address coercion for legacy records.
  const address = String(order?.address || fallbackAddress || '').trim();
  const label = bookingLocationLabel(order, appointment, languageCode).split(' · ')
    .filter((part) => text(part).toLocaleLowerCase('en') !== address.toLocaleLowerCase('en')).join(' · ');
  return label ? [address, label].filter(Boolean) : [address];
}

function bookingMessageAddress(order, fallbackAddress = '', options = {}) {
  // Meta's approved template still receives five single-line parameters.
  return bookingMessageAddressLines(order, fallbackAddress, options).join(' · ');
}

module.exports = { bookingLocationLabel, bookingMessageAddress, bookingMessageAddressLines };
