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

function bookingLocationLabel(order, appointment) {
  const snapshot = locationSnapshotForMessage(order, appointment);
  if (!snapshot) return '';
  // Allowlist destination text only. Access codes, private notes and contact
  // snapshots must never enter the customer-facing address parameter.
  return distinctParts([
    snapshot.locationLabel,
    snapshot.dwellingName,
    snapshot.dwellingCode,
    snapshot.areaName,
  ]);
}

function bookingMessageAddress(order, fallbackAddress = '') {
  const address = text(order?.address) || text(fallbackAddress);
  const label = bookingLocationLabel(order);
  return label ? distinctParts([address, label]) : address;
}

module.exports = { bookingLocationLabel, bookingMessageAddress };
