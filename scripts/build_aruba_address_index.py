from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]

OVERPASS_QUERY = r'''
[out:json][timeout:240];
area["ISO3166-1"="AW"]->.searchArea;
(
  way["highway"]["name"](area.searchArea);
  nwr["addr:street"](area.searchArea);
);
out tags center;
'''.strip()

REQUIRED_STREETS = ["Nijhoffstraat"]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Could not find expected snippet: {label}")
    return text.replace(old, new, 1)


def normalize_key(value: str) -> str:
    value = unicodedata.normalize("NFD", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]", "", value.lower())


def clean_name(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" ,;-/")
    if len(text) < 2 or text.isdigit():
        return ""
    return text


def split_names(value: object) -> list[str]:
    return [name for part in str(value or "").split(";") if (name := clean_name(part))]


def infer_operational_zone(place: str) -> str:
    key = normalize_key(place)
    if not key:
        return ""
    groups = [
        ("Noord", ["noord", "palmbeach", "eaglebeach", "bubali", "sabanaliber", "bakval", "malmok", "westpunt", "boegoeroei", "washington", "roo santo", "rooisanto", "turibana", "opal", "alto vista", "altovista", "kudawecha"]),
        ("Paradera", ["paradera", "piedraplat", "papaya", "cashero"]),
        ("Santa Cruz", ["santacruz", "hooiberg", "macuarima", "jaburibari", "balashi"]),
        ("Savaneta", ["savaneta", "poschiquito", "mangelhalto", "sabanabasora"]),
        ("San Nicolas", ["sannicolas", "sannicolaas", "brazil", "brasil", "zeewijk", "lagohights", "lagoheights", "seroecolorado"]),
        ("Oranjestad", ["oranjestad", "playa", "dakota", "wayaca", "tarabana", "morgenster", "seroeblanco", "ponton", "madiki", "tankileendert", "tankiflip"]),
    ]
    for zone, values in groups:
        if any(normalize_key(value) in key or key in normalize_key(value) for value in values):
            return zone
    return ""


def fetch_osm() -> dict:
    payload = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")
    headers = {
        "User-Agent": "DEMAC-Aruba-address-index/1.0 (https://github.com/demac-aruba/demac-corporation)",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    errors: list[str] = []
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(3):
            try:
                request = urllib.request.Request(endpoint, data=payload, headers=headers, method="POST")
                with urllib.request.urlopen(request, timeout=300) as response:
                    data = json.load(response)
                if not isinstance(data.get("elements"), list):
                    raise RuntimeError("Overpass response did not contain elements")
                return data
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
                errors.append(f"{endpoint} attempt {attempt + 1}: {exc}")
                time.sleep(3 * (attempt + 1))
    raise RuntimeError("Could not download Aruba street data. " + " | ".join(errors[-6:]))


def build_entries(data: dict) -> list[dict]:
    canonical_by_key: dict[str, str] = {}
    aliases_by_key: defaultdict[str, set[str]] = defaultdict(set)
    places_by_key: defaultdict[str, Counter[str]] = defaultdict(Counter)

    def register(name: str, aliases: list[str] | None = None, place: str = "") -> None:
        canonical = clean_name(name)
        key = normalize_key(canonical)
        if not key:
            return
        canonical_by_key.setdefault(key, canonical)
        for alias in aliases or []:
            cleaned = clean_name(alias)
            if cleaned and normalize_key(cleaned) != key:
                aliases_by_key[key].add(cleaned)
        if place:
            places_by_key[key][clean_name(place)] += 1

    for element in data.get("elements", []):
        tags = element.get("tags") or {}
        address_place = next((clean_name(tags.get(field)) for field in ("addr:suburb", "addr:district", "addr:city", "is_in:city", "is_in") if clean_name(tags.get(field))), "")
        street = clean_name(tags.get("addr:street"))
        if street:
            register(street, place=address_place)

        highway_name = clean_name(tags.get("name"))
        if highway_name:
            aliases: list[str] = []
            for field in ("alt_name", "official_name", "loc_name", "short_name", "old_name", "name:nl", "name:en", "name:pap"):
                aliases.extend(split_names(tags.get(field)))
            register(highway_name, aliases=aliases)

    for required in REQUIRED_STREETS:
        register(required)

    entries: list[dict] = []
    for key, canonical in canonical_by_key.items():
        place = places_by_key[key].most_common(1)[0][0] if places_by_key[key] else ""
        entries.append({
            "canonical": canonical,
            "neighborhood": place,
            "operationalZone": infer_operational_zone(place),
            "aliases": sorted(aliases_by_key[key], key=lambda item: item.casefold()),
        })
    entries.sort(key=lambda item: unicodedata.normalize("NFD", item["canonical"]).casefold())
    if len(entries) < 150:
        raise RuntimeError(f"Only {len(entries)} Aruba street names were generated; expected a substantially larger index.")
    if not any(normalize_key(entry["canonical"]) == normalize_key("Nijhoffstraat") for entry in entries):
        raise RuntimeError("Nijhoffstraat is missing from the generated index.")
    return entries


def ts_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def write_generated_entries(entries: list[dict]) -> None:
    generated_at = datetime.now(timezone.utc).date().isoformat()
    lines = [
        "// Generated from OpenStreetMap data. Do not edit manually.",
        "// © OpenStreetMap contributors, available under the ODbL.",
        "",
        "export type OsmArubaStreetEntry = {",
        "  canonical: string;",
        "  neighborhood?: string;",
        "  operationalZone?: string;",
        "  aliases?: readonly string[];",
        "};",
        "",
        f"export const osmArubaStreetIndexGeneratedAt = {ts_string(generated_at)};",
        "export const osmArubaStreetAttribution = '© OpenStreetMap contributors · ODbL';",
        "",
        "export const osmArubaStreetEntries: readonly OsmArubaStreetEntry[] = [",
    ]
    for entry in entries:
        fields = [f"canonical: {ts_string(entry['canonical'])}"]
        if entry["neighborhood"]:
            fields.append(f"neighborhood: {ts_string(entry['neighborhood'])}")
        if entry["operationalZone"]:
            fields.append(f"operationalZone: {ts_string(entry['operationalZone'])}")
        if entry["aliases"]:
            aliases = ", ".join(ts_string(alias) for alias in entry["aliases"])
            fields.append(f"aliases: [{aliases}]")
        lines.append("  { " + ", ".join(fields) + " },")
    lines.extend(["] as const;", ""])
    Path("src/data/arubaStreetNames.generated.ts").write_text("\n".join(lines), encoding="utf-8")


def update_curated_directory() -> None:
    path = Path("src/data/arubaAddresses.ts")
    text = path.read_text(encoding="utf-8")
    if "osmArubaStreetEntries" in text:
        return
    text = "import { osmArubaStreetEntries } from './arubaStreetNames.generated';\n\n" + text.lstrip()
    text = replace_once(text, "  aliases?: string[];\n", "  aliases?: string[];\n  source?: 'DEMAC' | 'OpenStreetMap';\n", "address source type")
    text = replace_once(text, "export const arubaAddressDirectory: ArubaAddressEntry[] = [", "const curatedArubaAddressDirectory: ArubaAddressEntry[] = [", "curated directory declaration")
    suffix = """

const curatedAddressKeys = new Set(curatedArubaAddressDirectory.map((entry) => entry.canonical.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')));

export const arubaAddressDirectory: ArubaAddressEntry[] = [
  ...curatedArubaAddressDirectory.map((entry) => ({ ...entry, source: 'DEMAC' as const })),
  ...osmArubaStreetEntries
    .filter((entry) => !curatedAddressKeys.has(entry.canonical.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map((entry) => ({
      canonical: entry.canonical,
      neighborhood: entry.neighborhood ?? '',
      operationalZone: entry.operationalZone ?? '',
      aliases: entry.aliases ? [...entry.aliases] : undefined,
      source: 'OpenStreetMap' as const,
    })),
];
"""
    text = text.rstrip() + suffix
    path.write_text(text, encoding="utf-8")


def update_agenda_screen() -> None:
    path = Path("src/screens/AgendaScreen.tsx")
    text = path.read_text(encoding="utf-8")
    if "AgendaAddressSuggestions" in text:
        return

    text = replace_once(
        text,
        "import { PhoneField } from '../components/PhoneField';\n",
        "import { PhoneField } from '../components/PhoneField';\nimport { ArubaAddressEntry } from '../data/arubaAddresses';\n",
        "Agenda ArubaAddressEntry import",
    )
    text = replace_once(
        text,
        "import { DEFAULT_PHONE_COUNTRY, normalizePhone, phoneComparisonKey, templateLanguageFor } from '../utils/phone';\n",
        "import { DEFAULT_PHONE_COUNTRY, normalizePhone, phoneComparisonKey, templateLanguageFor } from '../utils/phone';\nimport { applyAddressSuggestion, suggestArubaAddresses } from '../utils/location';\n",
        "Agenda location imports",
    )
    text = replace_once(text, "  address: string;\n  zone: string;\n};\n\nconst emptyQuickClientForm", "  address: string;\n  neighborhood: string;\n  zone: string;\n};\n\nconst emptyQuickClientForm", "QuickClientForm neighborhood")
    text = replace_once(text, "  address: '',\n  zone: '',\n};\n\ntype QuickPropertyForm", "  address: '',\n  neighborhood: '',\n  zone: '',\n};\n\ntype QuickPropertyForm", "empty quick client neighborhood")
    text = replace_once(text, "  address: string;\n  zone: string;\n  notes: string;\n};\n\nconst emptyQuickPropertyForm", "  address: string;\n  neighborhood: string;\n  zone: string;\n  notes: string;\n};\n\nconst emptyQuickPropertyForm", "QuickPropertyForm neighborhood")
    text = replace_once(text, "  address: '',\n  zone: '',\n  notes: '',\n};", "  address: '',\n  neighborhood: '',\n  zone: '',\n  notes: '',\n};", "empty quick property neighborhood")

    text = replace_once(
        text,
        "  const selectedProperty = clientProperties.find((item) => item.id === propertyId);\n",
        "  const selectedProperty = clientProperties.find((item) => item.id === propertyId);\n  const quickClientAddressSuggestions = suggestArubaAddresses(quickClient.address);\n  const quickPropertyAddressSuggestions = suggestArubaAddresses(quickProperty.address);\n",
        "Agenda suggestion calculations",
    )

    text = replace_once(
        text,
        "      address,\n      zone,\n      active: true,",
        "      address,\n      addressRaw: address,\n      addressNormalized: address,\n      neighborhood: quickClient.neighborhood.trim() || undefined,\n      operationalZone: zone,\n      zone,\n      active: true,",
        "quick client property address metadata",
    )
    text = replace_once(
        text,
        "    setQuickProperty({ ...emptyQuickPropertyForm, name: `Propiedad ${clientProperties.length + 1}`, zone: selectedClient.zone || 'Oranjestad' });",
        "    setQuickProperty({ ...emptyQuickPropertyForm, name: `Propiedad ${clientProperties.length + 1}`, zone: selectedClient.zone || 'Oranjestad' });",
        "quick property initializer",
    )
    text = replace_once(
        text,
        "      address: quickProperty.address.trim(),\n      zone: quickProperty.zone.trim() || selectedClient.zone || 'Aruba',",
        "      address: quickProperty.address.trim(),\n      addressRaw: quickProperty.address.trim(),\n      addressNormalized: quickProperty.address.trim(),\n      neighborhood: quickProperty.neighborhood.trim() || undefined,\n      operationalZone: quickProperty.zone.trim() || selectedClient.zone || 'Aruba',\n      zone: quickProperty.zone.trim() || selectedClient.zone || 'Aruba',",
        "quick property address metadata",
    )

    text = replace_once(text, "{showQuickClient ? (\n          <ScrollView>", "{showQuickClient ? (\n          <ScrollView keyboardShouldPersistTaps=\"handled\">", "quick client scroll taps")
    text = replace_once(text, ") : showQuickProperty ? (\n<ScrollView>", ") : showQuickProperty ? (\n<ScrollView keyboardShouldPersistTaps=\"handled\">", "quick property scroll taps")

    text = replace_once(
        text,
        "            <Input label=\"Dirección\" value={quickClient.address} onChangeText={(address) => setQuickClient({ ...quickClient, address })} placeholder=\"Calle, número y referencia\" />\n            <Input label=\"Zona\" value={quickClient.zone} onChangeText={(zone) => setQuickClient({ ...quickClient, zone })} placeholder=\"Ej. Oranjestad, Noord, Santa Cruz…\" />",
        "            <Input label=\"Dirección\" value={quickClient.address} onChangeText={(address) => setQuickClient({ ...quickClient, address })} placeholder=\"Calle y número\" />\n            <AgendaAddressSuggestions entries={quickClientAddressSuggestions} onSelect={(entry) => setQuickClient((current) => ({ ...current, address: applyAddressSuggestion(current.address, entry), neighborhood: entry.neighborhood || current.neighborhood, zone: entry.operationalZone || current.zone }))} />\n            <Input label=\"Sector / barrio\" value={quickClient.neighborhood} onChangeText={(neighborhood) => setQuickClient({ ...quickClient, neighborhood })} placeholder=\"Se completa cuando el directorio conoce el sector\" />\n            <Input label=\"Zona operativa\" value={quickClient.zone} onChangeText={(zone) => setQuickClient({ ...quickClient, zone })} placeholder=\"Ej. Oranjestad, Noord, Santa Cruz…\" />",
        "quick client address suggestions",
    )
    text = replace_once(
        text,
        "  <Input label=\"Dirección\" value={quickProperty.address} onChangeText={(address) => setQuickProperty({ ...quickProperty, address })} placeholder=\"Calle, número y referencia\" />\n  <Input label=\"Zona\" value={quickProperty.zone} onChangeText={(zone) => setQuickProperty({ ...quickProperty, zone })} placeholder=\"Ej. Oranjestad, Noord o Santa Cruz\" />",
        "  <Input label=\"Dirección\" value={quickProperty.address} onChangeText={(address) => setQuickProperty({ ...quickProperty, address })} placeholder=\"Calle y número\" />\n  <AgendaAddressSuggestions entries={quickPropertyAddressSuggestions} onSelect={(entry) => setQuickProperty((current) => ({ ...current, address: applyAddressSuggestion(current.address, entry), neighborhood: entry.neighborhood || current.neighborhood, zone: entry.operationalZone || current.zone }))} />\n  <Input label=\"Sector / barrio\" value={quickProperty.neighborhood} onChangeText={(neighborhood) => setQuickProperty({ ...quickProperty, neighborhood })} placeholder=\"Se completa cuando el directorio conoce el sector\" />\n  <Input label=\"Zona operativa\" value={quickProperty.zone} onChangeText={(zone) => setQuickProperty({ ...quickProperty, zone })} placeholder=\"Ej. Oranjestad, Noord o Santa Cruz\" />",
        "quick property address suggestions",
    )

    marker = "\nfunction VanColumn({ van, halfDay, extendedLayout, users, orders, cancelledSlots, services, clients, properties, selectedOrderId, onSelectOrder, onCreate, onCreateFromCancelled, closedReason }"
    component = r'''

function AgendaAddressSuggestions({ entries, onSelect }: { entries: ArubaAddressEntry[]; onSelect: (entry: ArubaAddressEntry) => void }) {
  if (!entries.length) return null;
  const includesOpenStreetMap = entries.some((entry) => entry.source === 'OpenStreetMap');
  return (
    <View style={agendaAddressStyles.container}>
      {entries.map((entry) => {
        const meta = [entry.neighborhood, entry.operationalZone].filter(Boolean).join(' · ') || 'Aruba · sector por confirmar';
        return (
          <Pressable accessibilityRole="button" key={`${entry.canonical}-${entry.neighborhood}`} onPress={() => onSelect(entry)} style={({ pressed }) => [agendaAddressStyles.option, pressed && agendaAddressStyles.optionPressed]}>
            <Text style={agendaAddressStyles.name}>{entry.canonical}</Text>
            <Text style={agendaAddressStyles.meta}>{meta}</Text>
          </Pressable>
        );
      })}
      {includesOpenStreetMap ? <Text style={agendaAddressStyles.attribution}>Datos de calles: © OpenStreetMap contributors · ODbL</Text> : null}
    </View>
  );
}

const agendaAddressStyles = StyleSheet.create({
  container: { gap: 6, marginTop: -5, marginBottom: 12 },
  option: { borderWidth: 1, borderColor: '#B8D7FF', backgroundColor: '#F4F8FF', borderRadius: 8, padding: 9 },
  optionPressed: { opacity: 0.72, backgroundColor: '#E7F1FF' },
  name: { color: colors.primaryDark, fontWeight: '900', fontSize: 11 },
  meta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  attribution: { color: colors.muted, fontSize: 8, marginTop: 2 },
});
'''
    if marker not in text:
        raise RuntimeError("Could not find VanColumn marker")
    text = text.replace(marker, component + marker, 1)
    path.write_text(text, encoding="utf-8")


def update_clients_attribution() -> None:
    path = Path("src/screens/ClientsScreen.tsx")
    text = path.read_text(encoding="utf-8")
    if "Datos de calles: © OpenStreetMap contributors" in text:
        return
    old = '''function AddressSuggestions({ entries, onSelect }: { entries: Array<{ canonical: string; neighborhood: string; operationalZone: string }>; onSelect: (entry: { canonical: string; neighborhood: string; operationalZone: string }) => void }) {
  if (!entries.length) return null;
  return (
    <View style={styles.addressSuggestions}>
      {entries.map((entry) => (
        <Pressable
          accessibilityRole="button"
          key={`${entry.canonical}-${entry.neighborhood}`}
          onPress={() => onSelect(entry)}
          style={({ pressed }) => [styles.addressSuggestion, pressed && styles.addressSuggestionPressed]}
        >
          <Text style={styles.addressSuggestionName}>{entry.canonical}</Text>
          <Text style={styles.addressSuggestionMeta}>{entry.neighborhood} · {entry.operationalZone}</Text>
        </Pressable>
      ))}
    </View>
  );
}'''
    new = '''function AddressSuggestions({ entries, onSelect }: { entries: Array<{ canonical: string; neighborhood: string; operationalZone: string; source?: 'DEMAC' | 'OpenStreetMap' }>; onSelect: (entry: { canonical: string; neighborhood: string; operationalZone: string; source?: 'DEMAC' | 'OpenStreetMap' }) => void }) {
  if (!entries.length) return null;
  return (
    <View style={styles.addressSuggestions}>
      {entries.map((entry) => {
        const meta = [entry.neighborhood, entry.operationalZone].filter(Boolean).join(' · ') || 'Aruba · sector por confirmar';
        return <Pressable accessibilityRole="button" key={`${entry.canonical}-${entry.neighborhood}`} onPress={() => onSelect(entry)} style={({ pressed }) => [styles.addressSuggestion, pressed && styles.addressSuggestionPressed]}><Text style={styles.addressSuggestionName}>{entry.canonical}</Text><Text style={styles.addressSuggestionMeta}>{meta}</Text></Pressable>;
      })}
      {entries.some((entry) => entry.source === 'OpenStreetMap') ? <Text style={styles.addressAttribution}>Datos de calles: © OpenStreetMap contributors · ODbL</Text> : null}
    </View>
  );
}'''
    text = replace_once(text, old, new, "Clients AddressSuggestions attribution")
    text = replace_once(text, "  addressSuggestionMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },", "  addressSuggestionMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },\n  addressAttribution: { color: colors.muted, fontSize: 8, marginTop: 2 },", "Clients attribution style")
    path.write_text(text, encoding="utf-8")


def main() -> None:
    data = fetch_osm()
    entries = build_entries(data)
    write_generated_entries(entries)
    update_curated_directory()
    update_agenda_screen()
    update_clients_attribution()
    print(f"Generated {len(entries)} unique Aruba street/address names.")
    nijhoff = [entry for entry in entries if normalize_key(entry['canonical']) == normalize_key('Nijhoffstraat')]
    print("Nijhoffstraat:", nijhoff[0] if nijhoff else "missing")


if __name__ == "__main__":
    main()
