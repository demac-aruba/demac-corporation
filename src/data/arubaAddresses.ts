import { osmArubaStreetEntries } from './arubaStreetNames.generated';

export type ArubaAddressEntry = {
  canonical: string;
  neighborhood: string;
  operationalZone: string;
  aliases?: string[];
  source?: 'DEMAC' | 'OpenStreetMap';
};

const curatedArubaAddressDirectory: ArubaAddressEntry[] = [
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

const curatedAddressKeys = new Set(curatedArubaAddressDirectory.map((entry) => entry.canonical.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')));

export const arubaAddressDirectory: ArubaAddressEntry[] = [
  ...curatedArubaAddressDirectory.map((entry) => ({ ...entry, source: 'DEMAC' as const })),
  ...osmArubaStreetEntries
    .filter((entry) => !curatedAddressKeys.has(entry.canonical.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')))
    .map((entry) => ({
      canonical: entry.canonical,
      neighborhood: entry.neighborhood ?? '',
      operationalZone: entry.operationalZone ?? '',
      aliases: entry.aliases ? [...entry.aliases] : undefined,
      source: 'OpenStreetMap' as const,
    })),
];
