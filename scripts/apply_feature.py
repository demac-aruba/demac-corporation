from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')
old = """  useEffect(() => {
    if (!clients.length) {
      setClientId('');
      setPropertyId('');
      return;
    }
    if (!clients.some((client) => client.id === clientId)) setClientId(clients[0].id);
  }, [clients, clientId]);"""
new = """  useEffect(() => {
    const activeClients = clients.filter((client) => client.active !== false);
    if (!activeClients.length) {
      setClientId('');
      setPropertyId('');
      return;
    }
    if (!activeClients.some((client) => client.id === clientId)) setClientId(activeClients[0].id);
  }, [clients, clientId]);"""
if old not in text:
    raise SystemExit('agenda active-client effect not found')
text = text.replace(old, new, 1)
old_filter = """    const matches = clients.filter((client) => {
      const haystack = `${client.name} ${client.company ?? ''} ${client.phone} ${client.whatsapp} ${client.address} ${client.zone}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });"""
new_filter = """    const matches = clients.filter((client) => {
      if (client.active === false) return false;
      const haystack = `${client.name} ${client.company ?? ''} ${client.phone} ${client.whatsapp} ${client.address} ${client.zone}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });"""
if old_filter not in text:
    raise SystemExit('agenda client filter not found')
text = text.replace(old_filter, new_filter, 1)
path.write_text(text, encoding='utf-8')
