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
STREET_WORDS = (
    "straat",
    "weg",
    "boulevard",
    "blvd",
    "street",
    "avenue",
    "laan",
    "drive",
    "road",
    "route",
    "plein",
    "caya",
    "camino",
)


def normalize_key(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]", "", normalized.lower())


def clean_name(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" ,;-/")
    if len(text) < 2 or text.isdigit():
        return ""
    return text


def split_names(value: object) -> list[str]:
    return [name for part in str(value or "").split(";") if (name := clean_name(part))]


def looks_like_street_name(value: str) -> bool:
    lowered = value.casefold()
    if re.search(r"\d", value):
        return False
    return any(word in lowered for word in STREET_WORDS)


def infer_operational_zone(place: str) -> str:
    key = normalize_key(place)
    groups = [
        ("Noord", ["noord", "palmbeach", "eaglebeach", "bubali", "sabanaliber", "bakval", "malmok", "westpunt", "boegoeroei", "washington", "rooisanto", "turibana", "opal", "altovista", "kudawecha"]),
        ("Paradera", ["paradera", "piedraplat", "papaya", "cashero"]),
        ("Santa Cruz", ["santacruz", "hooiberg", "macuarima", "jaburibari", "balashi"]),
        ("Savaneta", ["savaneta", "poschiquito", "mangelhalto", "sabanabasora"]),
        ("San Nicolas", ["sannicolas", "sannicolaas", "brazil", "brasil", "zeewijk", "lagoheights", "seroecolorado"]),
        ("Oranjestad", ["oranjestad", "playa", "dakota", "wayaca", "tarabana", "morgenster", "seroeblanco", "ponton", "madiki", "tankileendert", "tankiflip"]),
    ]
    for zone, names in groups:
        if key and any(normalize_key(name) in key or key in normalize_key(name) for name in names):
            return zone
    return ""


def fetch_osm() -> dict:
    payload = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")
    headers = {
        "User-Agent": "DEMAC-Aruba-address-index/1.2 (https://github.com/demac-aruba/demac-corporation)",
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
    highway_keys: set[str] = set()
    address_names: dict[str, str] = {}
    address_counts: Counter[str] = Counter()
    address_places: defaultdict[str, Counter[str]] = defaultdict(Counter)

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

        if tags.get("highway"):
            highway_name = clean_name(tags.get("name"))
            if highway_name:
                aliases: list[str] = []
                for field in ("alt_name", "official_name", "loc_name", "short_name", "old_name", "name:nl", "name:en", "name:pap"):
                    aliases.extend(split_names(tags.get(field)))
                register(highway_name, aliases=aliases)
                highway_keys.add(normalize_key(highway_name))

        street = clean_name(tags.get("addr:street"))
        if street:
            key = normalize_key(street)
            address_names.setdefault(key, street)
            address_counts[key] += 1
            place = next(
                (
                    clean_name(tags.get(field))
                    for field in ("addr:suburb", "addr:district", "addr:city", "is_in:city", "is_in")
                    if clean_name(tags.get(field))
                ),
                "",
            )
            if place:
                address_places[key][place] += 1

    for key, street in address_names.items():
        accepted = key in highway_keys or address_counts[key] >= 2 or looks_like_street_name(street)
        if not accepted:
            continue
        place = address_places[key].most_common(1)[0][0] if address_places[key] else ""
        register(street, place=place)

    for required in REQUIRED_STREETS:
        register(required)

    entries: list[dict] = []
    for key, canonical in canonical_by_key.items():
        place = places_by_key[key].most_common(1)[0][0] if places_by_key[key] else ""
        entries.append(
            {
                "canonical": canonical,
                "neighborhood": place,
                "operationalZone": infer_operational_zone(place),
                "aliases": sorted(aliases_by_key[key], key=str.casefold),
            }
        )

    entries.sort(key=lambda item: unicodedata.normalize("NFD", item["canonical"]).casefold())
    if len(entries) < 150:
        raise RuntimeError(f"Only {len(entries)} street names were generated; expected a larger Aruba index.")
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


def main() -> None:
    entries = build_entries(fetch_osm())
    write_generated_entries(entries)
    print(f"Generated {len(entries)} unique Aruba street/address names.")
    match = next(entry for entry in entries if normalize_key(entry["canonical"]) == normalize_key("Nijhoffstraat"))
    print("Nijhoffstraat:", match)


if __name__ == "__main__":
    main()
