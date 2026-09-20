/** Display the same canonical record whose token authorizes the proposed change. */
export function CanonicalAppointmentSummary({ appointment }: { appointment: Record<string, unknown> }) {
  const rows = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : [];
  const lines = rows(appointment.workLines), items = rows(appointment.workItems), assignments = rows(appointment.assignments);
  return <section aria-label="Current canonical appointment" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, display: 'grid', gap: 8 }}>
    <strong>Current appointment · {String(appointment.date || '')} · {String(appointment.startTime || '')}–{String(appointment.endTime || '')}</strong>
    <span>Status: {String(appointment.status || 'Unrecorded')}</span>
    {assignments.map((row, index) => <span key={index}>{String(row.vanName || row.vanId || 'Unrecorded Van')} · {row.role === 'support' ? 'Support' : 'Primary'} · {String(row.time || appointment.startTime || '')}–{String(row.capacityEndTime || row.endTime || appointment.endTime || '')}</span>)}
    {lines.map((line, index) => { const item = items.find(row => row.id === line.id) || items[index]; return <div key={index}>
      <strong>{String(line.quantity || '')} × {String(item?.label || line.presetId || 'Unrecorded work')}</strong>
      <p style={{ margin: '4px 0' }}>{String(line.customerFacingDescription || 'No custom work description recorded.')}</p>
      {line.technicianInstructions ? <p style={{ margin: '4px 0' }}>Instructions: {String(line.technicianInstructions)}</p> : null}
    </div>; })}
  </section>;
}
