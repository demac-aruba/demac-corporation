from pathlib import Path
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Could not find {label}')
    return text.replace(old, new, 1)

# -------------------------------------------------------------------------
# Local Aruba address seed. This is deliberately editable and learns from
# confirmed DEMAC entries; it does not claim to be an exhaustive registry.
# -------------------------------------------------------------------------
Path('src/data/arubaAddresses.ts').write_text(dedent("""
export type ArubaAddressEntry = {
  canonical: string;
  neighborhood: string;
  operationalZone: string;
  aliases?: string[];
};

export const arubaAddressDirectory: ArubaAddressEntry[] = [
  { canonical: 'Pampunastraat', neighborhood: 'Dakota', operationalZone: 'Oranjestad Este', aliases: ['Pampuna straat', 'Pampunastrat', 'Pampuna'] },
  { canonical: 'Venezuelastraat', neighborhood: 'Playa', operationalZone: 'Oranjestad Centro', aliases: ['Venezuela straat', 'Venezuelastrat', 'Venezuela str'] },
  { canonical: 'Caya G. F. Betico Croes', neighborhood: 'Playa', operationalZone: 'Oranjestad Centro', aliases: ['Betico Croes', 'Caya Betico', 'Main Street'] },
  { canonical: 'L.G. Smith Boulevard', neighborhood: 'Oranjestad', operationalZone: 'Oranjestad Centro', aliases: ['LG Smith Blvd', 'L G Smith Boulevard'] },
  { canonical: 'J.E. Irausquin Boulevard', neighborhood: 'Eagle Beach / Palm Beach', operationalZone: 'Noord / Hoteles', aliases: ['JE Irausquin', 'Irausquin Boulevard', 'Hotel Area'] },
  { canonical: 'Sasakiweg', neighborhood: 'Eagle Beach', operationalZone: 'Noord / Hoteles', aliases: ['Sasaki Weg', 'Sasaki Road'] },
  { canonical: 'Wilhelminastraat', neighborhood: 'Playa', operationalZone: 'Oranjestad Centro', aliases: ['Wilhelmina straat'] },
  { canonical: 'Zoutmanstraat', neighborhood: 'Playa', operationalZone: 'Oranjestad Centro', aliases: ['Zoutman straat'] },
  { canonical: 'Nassaustraat', neighborhood: 'Playa', operationalZone: 'Oranjestad Centro', aliases: ['Nassau straat'] },
  { canonical: 'Emmastraat', neighborhood: 'Oranjestad', operationalZone: 'Oranjestad Centro', aliases: ['Emma straat'] },
  { canonical: 'Kamerlingh Onnesstraat', neighborhood: 'Oranjestad', operationalZone: 'Oranjestad Centro', aliases: ['Kamerling Onnes', 'Kamerlingh Onnes'] },
  { canonical: 'Adriaan Lacle Boulevard', neighborhood: 'Oranjestad', operationalZone: 'Oranjestad Centro', aliases: ['Adriaan Lacle', 'Lacle Boulevard'] },
  { canonical: 'Wayaca', neighborhood: 'Wayaca', operationalZone: 'Oranjestad Este', aliases: ['Wajaca'] },
  { canonical: 'Dakota', neighborhood: 'Dakota', operationalZone: 'Oranjestad Este' },
  { canonical: 'Tarabana', neighborhood: 'Tarabana', operationalZone: 'Oranjestad Este' },
  { canonical: 'Morgenster', neighborhood: 'Morgenster', operationalZone: 'Oranjestad Este' },
  { canonical: 'Seroe Blanco', neighborhood: 'Seroe Blanco', operationalZone: 'Oranjestad Centro', aliases: ['Seru Blanco'] },
  { canonical: 'Ponton', neighborhood: 'Ponton', operationalZone: 'Oranjestad Oeste' },
  { canonical: 'Madiki', neighborhood: 'Madiki', operationalZone: 'Oranjestad Oeste' },
  { canonical: 'Tanki Leendert', neighborhood: 'Tanki Leendert', operationalZone: 'Oranjestad Oeste', aliases: ['Tanki Lender'] },
  { canonical: 'Tanki Flip', neighborhood: 'Tanki Flip', operationalZone: 'Oranjestad Oeste' },
  { canonical: 'Bubali', neighborhood: 'Bubali', operationalZone: 'Noord / Hoteles' },
  { canonical: 'Sabana Liber', neighborhood: 'Sabana Liber', operationalZone: 'Noord', aliases: ['Sabana Liper'] },
  { canonical: 'Boegoeroei', neighborhood: 'Boegoeroei', operationalZone: 'Noord', aliases: ['Bugurui', 'Boegeroei'] },
  { canonical: 'Washington', neighborhood: 'Washington', operationalZone: 'Noord' },
  { canonical: 'Palm Beach', neighborhood: 'Palm Beach', operationalZone: 'Noord / Hoteles', aliases: ['Palmbeach'] },
  { canonical: 'Bakval', neighborhood: 'Bakval', operationalZone: 'Noord / Hoteles' },
  { canonical: 'Rooi Santo', neighborhood: 'Rooi Santo', operationalZone: 'Noord', aliases: ['Roi Santo'] },
  { canonical: 'Turibana', neighborhood: 'Turibana', operationalZone: 'Noord' },
  { canonical: 'Alto Vista', neighborhood: 'Alto Vista', operationalZone: 'Noord' },
  { canonical: 'Malmok', neighborhood: 'Malmok', operationalZone: 'Noord' },
  { canonical: 'Westpunt', neighborhood: 'Westpunt', operationalZone: 'Noord', aliases: ['West Point'] },
  { canonical: 'Opal', neighborhood: 'Opal', operationalZone: 'Noord' },
  { canonical: 'Kudawecha', neighborhood: 'Kudawecha', operationalZone: 'Noord', aliases: ['Cudarecha'] },
  { canonical: 'Paradera', neighborhood: 'Paradera', operationalZone: 'Paradera' },
  { canonical: 'Piedra Plat', neighborhood: 'Piedra Plat', operationalZone: 'Paradera', aliases: ['Piedra Plato'] },
  { canonical: 'Papaya', neighborhood: 'Papaya', operationalZone: 'Paradera' },
  { canonical: 'Cashero', neighborhood: 'Cashero', operationalZone: 'Paradera', aliases: ['Cas Hero'] },
  { canonical: 'Santa Cruz', neighborhood: 'Santa Cruz', operationalZone: 'Santa Cruz' },
  { canonical: 'Macuarima', neighborhood: 'Macuarima', operationalZone: 'Santa Cruz' },
  { canonical: 'Hooiberg', neighborhood: 'Hooiberg', operationalZone: 'Santa Cruz', aliases: ['Hooi Berg'] },
  { canonical: 'Jaburibari', neighborhood: 'Jaburibari', operationalZone: 'Santa Cruz' },
  { canonical: 'Balashi', neighborhood: 'Balashi', operationalZone: 'Santa Cruz' },
  { canonical: 'Savaneta', neighborhood: 'Savaneta', operationalZone: 'Savaneta' },
  { canonical: 'Pos Chiquito', neighborhood: 'Pos Chiquito', operationalZone: 'Savaneta', aliases: ['Pos Chikito'] },
  { canonical: 'Mangel Halto', neighborhood: 'Mangel Halto', operationalZone: 'Savaneta' },
  { canonical: 'Sabana Basora', neighborhood: 'Sabana Basora', operationalZone: 'Savaneta' },
  { canonical: 'San Nicolas', neighborhood: 'San Nicolas', operationalZone: 'San Nicolas', aliases: ['San Nicolaas', 'San Nickolas'] },
  { canonical: 'Brazil', neighborhood: 'Brazil', operationalZone: 'San Nicolas', aliases: ['Brasil'] },
  { canonical: 'Lago Heights', neighborhood: 'Lago Heights', operationalZone: 'San Nicolas' },
  { canonical: 'Zeewijk', neighborhood: 'Zeewijk', operationalZone: 'San Nicolas', aliases: ['Zee Wijk'] },
  { canonical: 'Seroe Colorado', neighborhood: 'Seroe Colorado', operationalZone: 'San Nicolas', aliases: ['Seru Colorado'] },
  { canonical: 'Baby Beach', neighborhood: 'Seroe Colorado', operationalZone: 'San Nicolas' },
  { canonical: 'Rodgers Beach', neighborhood: 'Seroe Colorado', operationalZone: 'San Nicolas', aliases: ['Roger Beach'] },
];
"""), encoding='utf-8')

Path('src/utils/location.ts').write_text(dedent("""
import { arubaAddressDirectory, ArubaAddressEntry } from '../data/arubaAddresses';
import { PropertyLocation } from '../types';

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/straat/g, 'str').replace(/boulevard/g, 'blvd').replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(rows[row - 1][column] + 1, rows[row][column - 1] + 1, rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1));
    }
  }
  return rows[a.length][b.length];
}

export function suggestArubaAddresses(query: string, limit = 6): ArubaAddressEntry[] {
  const needle = normalize(query.replace(/\\d+[a-z-]*$/i, ''));
  if (needle.length < 2) return [];
  return arubaAddressDirectory.map((entry) => {
    const candidates = [entry.canonical, ...(entry.aliases ?? [])].map(normalize);
    const best = Math.max(...candidates.map((candidate) => candidate === needle ? 100 : candidate.startsWith(needle) ? 92 : candidate.includes(needle) ? 84 : Math.max(0, 72 - levenshtein(candidate, needle) * 7)));
    return { entry, best };
  }).filter((item) => item.best >= 35).sort((a, b) => b.best - a.best || a.entry.canonical.localeCompare(b.entry.canonical)).slice(0, limit).map((item) => item.entry);
}

export function applyAddressSuggestion(raw: string, suggestion: ArubaAddressEntry) {
  const house = raw.match(/\\b(\\d+[a-z-]*)\\b/i)?.[1];
  return `${suggestion.canonical}${house ? ` ${house}` : ''}`;
}

export function parseLocationInput(value: string): Partial<PropertyLocation> | null {
  const input = value.trim();
  if (!input) return null;
  let decoded = input;
  try { decoded = decodeURIComponent(input); } catch { /* keep original */ }
  const patterns = [
    /(?:ll=|q=|query=|destination=)(-?\\d{1,2}(?:\\.\\d+)?)[,%20\\s]+(-?\\d{1,3}(?:\\.\\d+)?)/i,
    /@(-?\\d{1,2}(?:\\.\\d+)?),(-?\\d{1,3}(?:\\.\\d+)?)/,
    /(-?\\d{1,2}\\.\\d+)\\s*[,; ]\\s*(-?\\d{1,3}\\.\\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      return { latitude, longitude, originalUrl: /^https?:/i.test(input) ? input : undefined };
    }
  }
  if (/^https?:\\/\\//i.test(input)) return { originalUrl: input };
  return null;
}

export function mapsMeUrl(location?: PropertyLocation, label = 'Ubicación DEMAC') {
  if (!location) return '';
  if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    return `https://dlink.maps.me/map?v=1&ll=${location.latitude},${location.longitude}&n=${encodeURIComponent(label)}`;
  }
  return location.originalUrl ?? '';
}

export function locationCoordinates(location?: PropertyLocation) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude) ? `${location?.latitude}, ${location?.longitude}` : '';
}

export function phoneDigits(value?: string) { return String(value ?? '').replace(/\\D/g, ''); }
"""), encoding='utf-8')

# -------------------------------------------------------------------------
# Types
# -------------------------------------------------------------------------
types_path = Path('src/types.ts')
types = types_path.read_text(encoding='utf-8')
types = replace_once(types, "export interface Property {", dedent("""
export type PropertyLocationSource = 'WhatsApp' | 'Enlace pegado' | 'Coordenadas' | 'Manual';

export interface PropertyLocation {
  latitude?: number;
  longitude?: number;
  originalUrl?: string;
  name?: string;
  address?: string;
  source: PropertyLocationSource;
  receivedFrom?: string;
  receivedAt?: string;
  verified: boolean;
  verifiedAt?: string;
  verifiedById?: string;
  verifiedByName?: string;
}

export interface WhatsAppLocationMessage {
  id: string;
  direction?: string;
  from?: string;
  contactName?: string;
  type?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  locationAddress?: string;
  locationUrl?: string;
  whatsappTimestamp?: string;
  receivedAt?: string;
  raw?: { location?: { latitude?: number; longitude?: number; name?: string; address?: string; url?: string } };
}

export interface Property {
"""), 'Property location types')
types = replace_once(types, "  notes?: string;\n  contacts?: PropertyContact[];", "  notes?: string;\n  addressRaw?: string;\n  addressNormalized?: string;\n  neighborhood?: string;\n  operationalZone?: string;\n  accessInstructions?: string;\n  landmark?: string;\n  location?: PropertyLocation;\n  contacts?: PropertyContact[];", 'Property address fields')
types = replace_once(types, "  equipmentId?: string;\n  measurements?: {", "  equipmentId?: string;\n  locationSnapshot?: PropertyLocation;\n  measurements?: {", 'WorkOrder location snapshot')
types_path.write_text(types, encoding='utf-8')

# -------------------------------------------------------------------------
# AppState: load inbound WhatsApp location messages.
# -------------------------------------------------------------------------
state_path = Path('src/state/AppState.tsx')
state = state_path.read_text(encoding='utf-8')
state = replace_once(state, "import { Client, InventoryItem, Invoice, Property, ServiceType, User, UserRole, WorkOrder } from '../types';", "import { Client, InventoryItem, Invoice, Property, ServiceType, User, UserRole, WhatsAppLocationMessage, WorkOrder } from '../types';", 'AppState types import')
state = replace_once(state, "  invoices: Invoice[];\n  hydrated:", "  invoices: Invoice[];\n  whatsappLocations: WhatsAppLocationMessage[];\n  hydrated:", 'AppState value locations')
state = replace_once(state, "  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);", "  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);\n  const [whatsappLocations, setWhatsappLocations] = useState<WhatsAppLocationMessage[]>([]);", 'AppState location state')
old_refresh = """      const [remoteClients, remoteProperties, remoteServices, remoteWorkOrders] = await Promise.all([
        listFirestoreCollection<Client>('clients'),
        listFirestoreCollection<Property>('properties'),
        listFirestoreCollection<ServiceType>('services'),
        listFirestoreCollection<WorkOrder>('workOrders'),
      ]);
      setClients(sortClients(remoteClients));
      setProperties(sortProperties(remoteProperties));
      setServices(sortCatalog(remoteServices));
      setWorkOrders(sortWorkOrders(remoteWorkOrders));"""
new_refresh = """      const [remoteClients, remoteProperties, remoteServices, remoteWorkOrders, remoteWhatsappMessages] = await Promise.all([
        listFirestoreCollection<Client>('clients'),
        listFirestoreCollection<Property>('properties'),
        listFirestoreCollection<ServiceType>('services'),
        listFirestoreCollection<WorkOrder>('workOrders'),
        listFirestoreCollection<WhatsAppLocationMessage>('whatsappMessages'),
      ]);
      setClients(sortClients(remoteClients));
      setProperties(sortProperties(remoteProperties));
      setServices(sortCatalog(remoteServices));
      setWorkOrders(sortWorkOrders(remoteWorkOrders));
      setWhatsappLocations(remoteWhatsappMessages.map((message) => ({
        ...message,
        latitude: Number(message.latitude ?? message.raw?.location?.latitude),
        longitude: Number(message.longitude ?? message.raw?.location?.longitude),
        locationName: message.locationName ?? message.raw?.location?.name,
        locationAddress: message.locationAddress ?? message.raw?.location?.address,
        locationUrl: message.locationUrl ?? message.raw?.location?.url,
      })).filter((message) => message.direction === 'inbound' && message.type === 'location' && Number.isFinite(message.latitude) && Number.isFinite(message.longitude)));
"""
state = replace_once(state, old_refresh, new_refresh, 'AppState refresh locations')
state = replace_once(state, "    setInvoices(demoInvoices);\n    setDataError(null);", "    setInvoices(demoInvoices);\n    setWhatsappLocations([]);\n    setDataError(null);", 'restore demo locations')
state = replace_once(state, "    invoices,\n    hydrated:", "    invoices,\n    whatsappLocations,\n    hydrated:", 'AppState value location data')
state = replace_once(state, "    invoices,\n    localHydrated,", "    invoices,\n    whatsappLocations,\n    localHydrated,", 'AppState dependency locations')
state_path.write_text(state, encoding='utf-8')

# -------------------------------------------------------------------------
# Webhook: expose Meta location data as queryable top-level fields.
# -------------------------------------------------------------------------
functions_path = Path('functions/index.js')
functions = functions_path.read_text(encoding='utf-8')
functions = replace_once(functions, "function digitsOnly(value) {", dedent("""
function messageLocation(message) {
  if (message?.type !== 'location' || !message.location) return {};
  return {
    latitude: Number(message.location.latitude),
    longitude: Number(message.location.longitude),
    locationName: message.location.name ?? null,
    locationAddress: message.location.address ?? null,
    locationUrl: message.location.url ?? null,
  };
}

function digitsOnly(value) {
"""), 'webhook location helper')
functions = replace_once(functions, "              text: messageText(message),\n              whatsappTimestamp:", "              text: messageText(message),\n              ...messageLocation(message),\n              whatsappTimestamp:", 'webhook location fields')
functions_path.write_text(functions, encoding='utf-8')

# -------------------------------------------------------------------------
# Agenda: snapshot property location on create/edit/reschedule.
# -------------------------------------------------------------------------
agenda_path = Path('src/screens/AgendaScreen.tsx')
agenda = agenda_path.read_text(encoding='utf-8')
needle = "        zone,\n        problem: description,"
if agenda.count(needle) < 3:
    raise SystemExit(f'Expected at least three appointment zone blocks, found {agenda.count(needle)}')
agenda = agenda.replace(needle, "        zone,\n        locationSnapshot: selectedProperty?.location,\n        problem: description,")
agenda_path.write_text(agenda, encoding='utf-8')

# -------------------------------------------------------------------------
# Technician: show and open location snapshot.
# -------------------------------------------------------------------------
technician_path = Path('src/screens/TechnicianScreen.tsx')
technician = technician_path.read_text(encoding='utf-8')
technician = replace_once(technician, "import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';", "import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';", 'Technician Linking import')
technician = replace_once(technician, "import { AppointmentStatus } from '../types';", "import { AppointmentStatus } from '../types';\nimport { locationCoordinates, mapsMeUrl } from '../utils/location';", 'Technician location import')
technician = replace_once(technician, "  const unit = equipment.find((item) => item.id === selected?.equipmentId);", "  const unit = equipment.find((item) => item.id === selected?.equipmentId);\n  const location = selected?.locationSnapshot;", 'Technician location const')
technician = replace_once(technician, "              <Text style={styles.address}>{selected.address}</Text>", "              <Text style={styles.address}>{selected.address}</Text>\n              {location ? <View style={styles.locationBox}><Text style={styles.locationTitle}>UBICACIÓN COMPARTIDA POR EL CLIENTE</Text><Text style={styles.locationText}>{location.address || location.name || locationCoordinates(location) || 'Enlace de ubicación guardado'}</Text><View style={styles.locationActions}><Button compact label=\"Abrir en MAPS.ME\" onPress={() => { const url = mapsMeUrl(location, client?.name ?? 'Cliente DEMAC'); if (url) void Linking.openURL(url); }} /><Button compact variant=\"secondary\" label=\"Copiar coordenadas\" disabled={!locationCoordinates(location)} onPress={() => void (globalThis as any).navigator?.clipboard?.writeText(locationCoordinates(location))} /></View></View> : null}", 'Technician location UI')
technician = replace_once(technician, "  problemBox: { backgroundColor:", "  locationBox: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 13, marginTop: 12 },\n  locationTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 9, letterSpacing: 1 },\n  locationText: { color: colors.text, marginTop: 6, fontWeight: '700' },\n  locationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },\n  problemBox: { backgroundColor:", 'Technician location styles')
technician_path.write_text(technician, encoding='utf-8')

# -------------------------------------------------------------------------
# Clients screen: property editing, fuzzy address suggestions, pasted
# coordinates/links, matching inbound WhatsApp locations and MAPS.ME actions.
# -------------------------------------------------------------------------
clients_path = Path('src/screens/ClientsScreen.tsx')
clients = clients_path.read_text(encoding='utf-8')
clients = replace_once(clients, "import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';", "import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';", 'Clients Linking import')
clients = replace_once(clients, "import { Client, ClientLifecycleEntry, PreferredLanguage, Property, PropertyContact, PropertyContactLanguage, PropertyContactRole, PropertyType } from '../types';", "import { Client, ClientLifecycleEntry, PreferredLanguage, Property, PropertyContact, PropertyContactLanguage, PropertyContactRole, PropertyLocation, PropertyType, WhatsAppLocationMessage } from '../types';", 'Clients location types')
clients = replace_once(clients, "import { DEFAULT_PHONE_COUNTRY, formatStoredPhone, normalizePhone, phoneComparisonKey, templateLanguageFor } from '../utils/phone';", "import { DEFAULT_PHONE_COUNTRY, formatStoredPhone, normalizePhone, phoneComparisonKey, templateLanguageFor } from '../utils/phone';\nimport { applyAddressSuggestion, locationCoordinates, mapsMeUrl, parseLocationInput, phoneDigits, suggestArubaAddresses } from '../utils/location';", 'Clients location utils')
clients = replace_once(clients, "    currentUser, clients, properties, equipment, workOrders, invoices,", "    currentUser, clients, properties, equipment, workOrders, invoices, whatsappLocations,", 'Clients location state')
clients = replace_once(clients, "  const [showProperty, setShowProperty] = useState(false);", "  const [showProperty, setShowProperty] = useState(false);\n  const [editingPropertyId, setEditingPropertyId] = useState('');", 'Clients property edit state')
clients = replace_once(clients, "  const [form, setForm] = useState({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY as string, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY as string, email: '', preferredLanguage: 'Español' as PreferredLanguage, address: '', zone: 'Oranjestad' });", "  const [form, setForm] = useState({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY as string, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY as string, email: '', preferredLanguage: 'Español' as PreferredLanguage, address: '', zone: 'Oranjestad', neighborhood: '', locationInput: '', accessInstructions: '', landmark: '' });", 'Clients new form location fields')
clients = replace_once(clients, "  const [propertyForm, setPropertyForm] = useState({ name: 'Propiedad principal', type: 'Casa' as PropertyType, address: '', zone: 'Oranjestad', notes: '' });", "  const [propertyForm, setPropertyForm] = useState({ name: 'Propiedad principal', type: 'Casa' as PropertyType, address: '', zone: 'Oranjestad', neighborhood: '', notes: '', locationInput: '', accessInstructions: '', landmark: '' });", 'Clients property form location fields')
clients = replace_once(clients, "    setForm({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY, email: '', preferredLanguage: 'Español', address: '', zone: 'Oranjestad' });", "    setForm({ name: '', company: '', phone: '', phoneCountry: DEFAULT_PHONE_COUNTRY, whatsapp: '', whatsappCountry: DEFAULT_PHONE_COUNTRY, email: '', preferredLanguage: 'Español', address: '', zone: 'Oranjestad', neighborhood: '', locationInput: '', accessInstructions: '', landmark: '' });", 'Clients reset location fields')

# helper functions inserted before createClient
marker = "  const createClient = async () => {"
helpers = dedent("""
  const clientAddressSuggestions = suggestArubaAddresses(form.address);
  const propertyAddressSuggestions = suggestArubaAddresses(propertyForm.address);

  const buildLocation = (input: string, source: PropertyLocation['source']): PropertyLocation | undefined => {
    const parsed = parseLocationInput(input);
    if (!parsed) return undefined;
    return { ...parsed, source, verified: true, verifiedAt: new Date().toISOString(), verifiedById: currentUser?.id, verifiedByName: currentUser?.name ?? 'Usuario DEMAC' };
  };

  const matchingLocations = (property: Property) => {
    const phones = [selected?.phone, selected?.whatsapp, ...(property.contacts ?? []).flatMap((contact) => [contact.phone, contact.whatsapp])].map(phoneDigits).filter(Boolean);
    return whatsappLocations.filter((message) => phones.includes(phoneDigits(message.from))).slice(0, 5);
  };

  const assignWhatsAppLocation = async (property: Property, message: WhatsAppLocationMessage) => {
    const location: PropertyLocation = {
      latitude: Number(message.latitude ?? message.raw?.location?.latitude),
      longitude: Number(message.longitude ?? message.raw?.location?.longitude),
      originalUrl: message.locationUrl ?? message.raw?.location?.url,
      name: message.locationName ?? message.raw?.location?.name,
      address: message.locationAddress ?? message.raw?.location?.address,
      source: 'WhatsApp', receivedFrom: message.from, receivedAt: message.receivedAt ?? message.whatsappTimestamp,
      verified: true, verifiedAt: new Date().toISOString(), verifiedById: currentUser?.id, verifiedByName: currentUser?.name ?? 'Usuario DEMAC',
    };
    const result = await updateProperty(property.id, { location });
    if (!result.ok) setScreenMessage(result.message ?? 'No se pudo asignar la ubicación.');
    else setScreenMessage(`Ubicación de ${message.contactName || message.from || 'WhatsApp'} asignada a ${property.name}.`);
  };

  const openLocation = (property: Property) => {
    const url = mapsMeUrl(property.location, `${selected?.name ?? 'Cliente'} - ${property.name}`);
    if (url) void Linking.openURL(url);
  };

  const copyLocation = (property: Property) => {
    const value = locationCoordinates(property.location) || property.location?.originalUrl || '';
    if (value) void (globalThis as any).navigator?.clipboard?.writeText(value);
  };

""")
clients = replace_once(clients, marker, helpers + marker, 'Clients location helpers')

# first property data
clients = replace_once(clients, "    const initialProperty: Property = { id: `property-${timestamp}`, clientId: client.id, name: 'Propiedad principal', type: 'Casa', address: client.address, zone: client.zone, active: true, createdAt: now, updatedAt: now };", "    const initialLocation = buildLocation(form.locationInput, /^https?:/i.test(form.locationInput.trim()) ? 'Enlace pegado' : 'Coordenadas');\n    const initialProperty: Property = { id: `property-${timestamp}`, clientId: client.id, name: 'Propiedad principal', type: 'Casa', address: client.address, addressRaw: form.address.trim(), addressNormalized: form.address.trim(), neighborhood: form.neighborhood || undefined, operationalZone: client.zone, zone: client.zone, accessInstructions: form.accessInstructions.trim() || undefined, landmark: form.landmark.trim() || undefined, location: initialLocation, active: true, createdAt: now, updatedAt: now };", 'Initial property location')

# replace property open/create functions
old_property_functions = """  const openPropertyModal = () => {
    if (!selected) return;
    setPropertyForm({ name: `Propiedad ${selectedProperties.length + 1}`, type: 'Casa', address: '', zone: selected.zone || 'Oranjestad', notes: '' });
    setShowProperty(true);
  };

  const createProperty = async () => {
    if (!selected || !propertyForm.name.trim() || !propertyForm.address.trim()) return setScreenMessage('Escribe el nombre y la dirección de la propiedad.');
    const now = new Date().toISOString();
    setSaving(true);
    const result = await addProperty({ id: `property-${Date.now()}`, clientId: selected.id, name: propertyForm.name.trim(), type: propertyForm.type, address: propertyForm.address.trim(), zone: propertyForm.zone.trim() || 'Aruba', notes: propertyForm.notes.trim() || undefined, active: true, createdAt: now, updatedAt: now });
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo guardar la propiedad.');
    setShowProperty(false);
  };"""
new_property_functions = """  const openPropertyModal = () => {
    if (!selected) return;
    setEditingPropertyId('');
    setPropertyForm({ name: `Propiedad ${selectedProperties.length + 1}`, type: 'Casa', address: '', zone: selected.zone || 'Oranjestad', neighborhood: '', notes: '', locationInput: '', accessInstructions: '', landmark: '' });
    setShowProperty(true);
  };

  const openEditProperty = (property: Property) => {
    setEditingPropertyId(property.id);
    setPropertyForm({ name: property.name, type: property.type, address: property.address, zone: property.operationalZone || property.zone, neighborhood: property.neighborhood || '', notes: property.notes || '', locationInput: property.location ? (locationCoordinates(property.location) || property.location.originalUrl || '') : '', accessInstructions: property.accessInstructions || '', landmark: property.landmark || '' });
    setShowProperty(true);
  };

  const saveProperty = async () => {
    if (!selected || !propertyForm.name.trim() || !propertyForm.address.trim()) return setScreenMessage('Escribe el nombre y la dirección de la propiedad.');
    if (propertyForm.locationInput.trim() && !parseLocationInput(propertyForm.locationInput)) return setScreenMessage('La ubicación no contiene coordenadas o un enlace válido.');
    const now = new Date().toISOString();
    const existing = properties.find((property) => property.id === editingPropertyId);
    const location = propertyForm.locationInput.trim() ? buildLocation(propertyForm.locationInput, /^https?:/i.test(propertyForm.locationInput.trim()) ? 'Enlace pegado' : 'Coordenadas') : existing?.location;
    const data: Property = { id: existing?.id ?? `property-${Date.now()}`, clientId: selected.id, name: propertyForm.name.trim(), type: propertyForm.type, address: propertyForm.address.trim(), addressRaw: propertyForm.address.trim(), addressNormalized: propertyForm.address.trim(), neighborhood: propertyForm.neighborhood.trim() || undefined, operationalZone: propertyForm.zone.trim() || 'Aruba', zone: propertyForm.zone.trim() || 'Aruba', notes: propertyForm.notes.trim() || undefined, accessInstructions: propertyForm.accessInstructions.trim() || undefined, landmark: propertyForm.landmark.trim() || undefined, location, contacts: existing?.contacts, active: existing?.active ?? true, createdAt: existing?.createdAt ?? now, updatedAt: now };
    setSaving(true);
    const result = existing ? await updateProperty(existing.id, data) : await addProperty(data);
    setSaving(false);
    if (!result.ok) return setScreenMessage(result.message ?? 'No se pudo guardar la propiedad.');
    setShowProperty(false); setEditingPropertyId('');
  };"""
clients = replace_once(clients, old_property_functions, new_property_functions, 'Clients property save flow')

# property card content and actions
old_meta = "<Text style={styles.propertyMeta}>{property.zone}{property.notes ? ` · ${property.notes}` : ''} · {linkedWorkCount} trabajo(s)</Text>"
new_meta = "<Text style={styles.propertyMeta}>{property.neighborhood ? `${property.neighborhood} · ` : ''}{property.operationalZone || property.zone}{property.notes ? ` · ${property.notes}` : ''} · {linkedWorkCount} trabajo(s)</Text>{property.landmark ? <Text style={styles.propertyMeta}>Referencia: {property.landmark}</Text> : null}{property.accessInstructions ? <Text style={styles.propertyMeta}>Acceso: {property.accessInstructions}</Text> : null}{property.location ? <View style={styles.savedLocation}><Text style={styles.savedLocationTitle}>✓ Ubicación {property.location.source}</Text><Text style={styles.savedLocationText}>{property.location.address || property.location.name || locationCoordinates(property.location) || property.location.originalUrl}</Text></View> : null}{matchingLocations(property).length ? <View style={styles.receivedLocations}><Text style={styles.receivedTitle}>Ubicaciones recibidas por WhatsApp</Text>{matchingLocations(property).map((message) => <View key={message.id} style={styles.receivedRow}><Text style={styles.receivedText}>{message.contactName || message.from} · {message.locationAddress || message.locationName || `${message.latitude}, ${message.longitude}`}</Text><Button compact variant=\"secondary\" label=\"Asignar\" onPress={() => void assignWhatsAppLocation(property, message)} /></View>)}</View> : null}"
clients = replace_once(clients, old_meta, new_meta, 'Property location display')
old_actions = "<View style={{ gap: 6 }}><Button compact variant=\"secondary\" label=\"Agregar contacto\" onPress={() => openContactModal(property)} />{property.active === false ?"
new_actions = "<View style={{ gap: 6 }}><Button compact variant=\"secondary\" label=\"Editar propiedad\" onPress={() => openEditProperty(property)} /><Button compact variant=\"secondary\" label=\"Agregar contacto\" onPress={() => openContactModal(property)} />{property.location ? <><Button compact label=\"Abrir MAPS.ME\" onPress={() => openLocation(property)} /><Button compact variant=\"ghost\" label=\"Copiar ubicación\" onPress={() => copyLocation(property)} /></> : null}{property.active === false ?"
clients = replace_once(clients, old_actions, new_actions, 'Property location actions')

# create client address fields and suggestions
old_create_address = "<Text style={styles.formSection}>PRIMERA PROPIEDAD</Text><Input label=\"Dirección\" value={form.address} onChangeText={(address) => setForm({ ...form, address })} /><Input label=\"Zona\" value={form.zone} onChangeText={(zone) => setForm({ ...form, zone })} />"
new_create_address = "<Text style={styles.formSection}>PRIMERA PROPIEDAD</Text><Input label=\"Dirección\" value={form.address} onChangeText={(address) => setForm({ ...form, address })} /><AddressSuggestions entries={clientAddressSuggestions} onSelect={(entry) => setForm({ ...form, address: applyAddressSuggestion(form.address, entry), neighborhood: entry.neighborhood, zone: entry.operationalZone })} /><Input label=\"Sector / barrio\" value={form.neighborhood} onChangeText={(neighborhood) => setForm({ ...form, neighborhood })} /><Input label=\"Zona operativa\" value={form.zone} onChangeText={(zone) => setForm({ ...form, zone })} /><Input label=\"Pegar ubicación, enlace o coordenadas (opcional)\" value={form.locationInput} onChangeText={(locationInput) => setForm({ ...form, locationInput })} placeholder=\"12.512345, -69.987654 o enlace compartido\" /><Input label=\"Punto de referencia (opcional)\" value={form.landmark} onChangeText={(landmark) => setForm({ ...form, landmark })} /><Input label=\"Instrucciones de acceso (opcional)\" value={form.accessInstructions} onChangeText={(accessInstructions) => setForm({ ...form, accessInstructions })} multiline />"
clients = replace_once(clients, old_create_address, new_create_address, 'Client initial location fields')

# property modal
old_property_modal = "<AppModal visible={showProperty} title=\"Agregar propiedad\" onClose={() => !saving && setShowProperty(false)}><Input label=\"Nombre para identificarla\" value={propertyForm.name} onChangeText={(name) => setPropertyForm({ ...propertyForm, name })} /><Text style={styles.inputLabel}>Tipo</Text><View style={styles.typeWrap}>{propertyTypes.map((type) => <Pressable key={type} onPress={() => setPropertyForm({ ...propertyForm, type })} style={[styles.typeButton, propertyForm.type === type && styles.typeButtonActive]}><Text style={[styles.typeText, propertyForm.type === type && styles.typeTextActive]}>{type}</Text></Pressable>)}</View><Input label=\"Dirección\" value={propertyForm.address} onChangeText={(address) => setPropertyForm({ ...propertyForm, address })} /><Input label=\"Zona\" value={propertyForm.zone} onChangeText={(zone) => setPropertyForm({ ...propertyForm, zone })} /><Input label=\"Notas de acceso\" value={propertyForm.notes} onChangeText={(notes) => setPropertyForm({ ...propertyForm, notes })} multiline /><View style={styles.modalActions}><Button variant=\"secondary\" label=\"Cancelar\" onPress={() => setShowProperty(false)} /><Button label={saving ? 'Guardando…' : 'Guardar propiedad'} disabled={saving} onPress={() => void createProperty()} /></View></AppModal>"
new_property_modal = "<AppModal visible={showProperty} title={editingPropertyId ? 'Editar propiedad' : 'Agregar propiedad'} onClose={() => !saving && setShowProperty(false)}><ScrollView><Input label=\"Nombre para identificarla\" value={propertyForm.name} onChangeText={(name) => setPropertyForm({ ...propertyForm, name })} /><Text style={styles.inputLabel}>Tipo</Text><View style={styles.typeWrap}>{propertyTypes.map((type) => <Pressable key={type} onPress={() => setPropertyForm({ ...propertyForm, type })} style={[styles.typeButton, propertyForm.type === type && styles.typeButtonActive]}><Text style={[styles.typeText, propertyForm.type === type && styles.typeTextActive]}>{type}</Text></Pressable>)}</View><Input label=\"Dirección proporcionada por el cliente\" value={propertyForm.address} onChangeText={(address) => setPropertyForm({ ...propertyForm, address })} /><AddressSuggestions entries={propertyAddressSuggestions} onSelect={(entry) => setPropertyForm({ ...propertyForm, address: applyAddressSuggestion(propertyForm.address, entry), neighborhood: entry.neighborhood, zone: entry.operationalZone })} /><Input label=\"Sector / barrio\" value={propertyForm.neighborhood} onChangeText={(neighborhood) => setPropertyForm({ ...propertyForm, neighborhood })} /><Input label=\"Zona operativa\" value={propertyForm.zone} onChangeText={(zone) => setPropertyForm({ ...propertyForm, zone })} /><Input label=\"Pegar ubicación, enlace o coordenadas\" value={propertyForm.locationInput} onChangeText={(locationInput) => setPropertyForm({ ...propertyForm, locationInput })} placeholder=\"12.512345, -69.987654 o enlace de MAPS.ME / WhatsApp\" /><Input label=\"Punto de referencia\" value={propertyForm.landmark} onChangeText={(landmark) => setPropertyForm({ ...propertyForm, landmark })} /><Input label=\"Instrucciones de acceso\" value={propertyForm.accessInstructions} onChangeText={(accessInstructions) => setPropertyForm({ ...propertyForm, accessInstructions })} multiline /><Input label=\"Notas internas\" value={propertyForm.notes} onChangeText={(notes) => setPropertyForm({ ...propertyForm, notes })} multiline /><View style={styles.modalActions}><Button variant=\"secondary\" label=\"Cancelar\" onPress={() => setShowProperty(false)} /><Button label={saving ? 'Guardando…' : 'Guardar propiedad'} disabled={saving} onPress={() => void saveProperty()} /></View></ScrollView></AppModal>"
clients = replace_once(clients, old_property_modal, new_property_modal, 'Property modal location fields')

# helper component and styles
clients = replace_once(clients, "function Toggle({ label, active, onPress }:", "function AddressSuggestions({ entries, onSelect }: { entries: Array<{ canonical: string; neighborhood: string; operationalZone: string }>; onSelect: (entry: { canonical: string; neighborhood: string; operationalZone: string }) => void }) { return entries.length ? <View style={styles.addressSuggestions}>{entries.map((entry) => <Pressable key={`${entry.canonical}-${entry.neighborhood}`} onPress={() => onSelect(entry)} style={styles.addressSuggestion}><Text style={styles.addressSuggestionName}>¿Buscabas {entry.canonical}?</Text><Text style={styles.addressSuggestionMeta}>{entry.neighborhood} · {entry.operationalZone}</Text></Pressable>)}</View> : null; }\nfunction Toggle({ label, active, onPress }:", 'Address suggestion component')
clients = replace_once(clients, "  duplicateCard: {", "  addressSuggestions: { gap: 6, marginTop: -5, marginBottom: 12 },\n  addressSuggestion: { borderWidth: 1, borderColor: '#B8D7FF', backgroundColor: '#F4F8FF', borderRadius: 8, padding: 9 },\n  addressSuggestionName: { color: colors.primaryDark, fontWeight: '900', fontSize: 11 },\n  addressSuggestionMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },\n  savedLocation: { backgroundColor: colors.successLight, borderRadius: 9, padding: 9, marginTop: 8 },\n  savedLocationTitle: { color: colors.success, fontWeight: '900', fontSize: 9 },\n  savedLocationText: { color: colors.text, fontSize: 10, marginTop: 4 },\n  receivedLocations: { backgroundColor: '#F7F9FC', borderRadius: 9, padding: 9, marginTop: 8 },\n  receivedTitle: { color: colors.primaryDark, fontWeight: '900', fontSize: 9, marginBottom: 5 },\n  receivedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, paddingVertical: 4 },\n  receivedText: { color: colors.text, fontSize: 9, flex: 1, minWidth: 180 },\n  duplicateCard: {", 'Location styles')
clients_path.write_text(clients, encoding='utf-8')
