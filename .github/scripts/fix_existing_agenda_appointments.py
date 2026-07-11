from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str):
    global text
    if old not in text:
        raise SystemExit(f'Missing source fragment: {old[:120]!r}')
    text = text.replace(old, new, 1)

replace_once(
"""function vanCanReceiveAppointments(van: AgendaVan) {
  return van.active !== false
    && !!van.driverStaffId
    && !['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(van.status);
}
""",
"""function vanCanReceiveAppointments(van: AgendaVan) {
  return van.active !== false
    && !!van.driverStaffId
    && !['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(van.status);
}

function normalizeVanName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function resolveStoredVanId(storedVanId: string, agendaVans: AgendaVan[], legacyVans: Van[]) {
  if (agendaVans.some((van) => van.id === storedVanId)) return storedVanId;

  const legacyIndex = legacyVans.findIndex((van) => van.id === storedVanId);
  const legacyVan = legacyIndex >= 0 ? legacyVans[legacyIndex] : undefined;
  if (legacyVan) {
    const matchingName = agendaVans.find((van) => normalizeVanName(van.name) === normalizeVanName(legacyVan.name));
    if (matchingName) return matchingName.id;
    if (agendaVans[legacyIndex]) return agendaVans[legacyIndex].id;
  }

  const number = storedVanId.match(/(\\d+)$/)?.[1];
  if (number) {
    const matchingNumber = agendaVans.find((van) => normalizeVanName(van.name) === `van${number}`);
    if (matchingNumber) return matchingNumber.id;
  }

  return storedVanId;
}
""",
)

replace_once(
"""  const staffDirectory = useMemo(
    () => staffProfiles.length
      ? staffProfiles.map((profile) => ({ id: profile.id, name: profile.name }))
      : legacyUsers.map((user) => ({ id: user.id, name: user.name })),
    [staffProfiles, legacyUsers],
  );
""",
"""  const staffDirectory = useMemo(() => {
    const directory = new Map(legacyUsers.map((user) => [user.id, { id: user.id, name: user.name }]));
    staffProfiles.forEach((profile) => directory.set(profile.id, { id: profile.id, name: profile.name }));
    return Array.from(directory.values());
  }, [staffProfiles, legacyUsers]);
""",
)

replace_once(
"""  const orders = useMemo(
    () => workOrders.filter((order) => order.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time)),
    [workOrders, selectedDate],
  );
""",
"""  const orders = useMemo(
    () => workOrders
      .filter((order) => order.date === selectedDate)
      .map((order) => {
        const resolvedVanId = resolveStoredVanId(order.vanId, agendaVans, legacyVans);
        return resolvedVanId === order.vanId ? order : { ...order, vanId: resolvedVanId };
      })
      .sort((a, b) => a.time.localeCompare(b.time)),
    [workOrders, selectedDate, agendaVans, legacyVans],
  );
""",
)

replace_once(
"""        order.date === date &&
        order.vanId === candidateVan.id &&
        candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services)),
""",
"""        order.date === date &&
        resolveStoredVanId(order.vanId, agendaVans, legacyVans) === candidateVan.id &&
        candidateSlots.some((slot) => orderOccupiesSlot(order, slot, services)),
""",
)

path.write_text(text, encoding='utf-8')
