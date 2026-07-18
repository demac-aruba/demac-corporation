import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppModal, Button, Input } from './UI';
import { colors } from '../theme';
import {
  allPhoneCountries,
  asCountryCode,
  countryCallingCode,
  countryFlag,
  countryName,
  internationalSuggestion,
  normalizePhone,
} from '../utils/phone';

export function PhoneField({
  label,
  value,
  country,
  onChangeText,
  onCountryChange,
  placeholder,
}: {
  label: string;
  value: string;
  country?: string;
  onChangeText: (value: string) => void;
  onCountryChange: (country: string) => void;
  placeholder?: string;
}) {
  const selectedCountry = asCountryCode(country);
  const [showCountries, setShowCountries] = useState(false);
  const [query, setQuery] = useState('');
  const normalized = useMemo(() => normalizePhone(value, selectedCountry), [value, selectedCountry]);
  const suggestion = useMemo(() => internationalSuggestion(value, selectedCountry), [value, selectedCountry]);
  const filteredCountries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = allPhoneCountries();
    if (!needle) return all;
    return all.filter((item) => `${item.name} ${item.country} ${item.callingCode}`.toLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    if (normalized.explicitInternational && normalized.valid && normalized.country !== selectedCountry) {
      onCountryChange(normalized.country);
    }
  }, [normalized.explicitInternational, normalized.valid, normalized.country, selectedCountry, onCountryChange]);

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable onPress={() => setShowCountries(true)} style={styles.countryButton}>
<Text style={styles.flag}>{countryFlag(selectedCountry)}</Text>
<Text style={styles.callingCode}>{countryCallingCode(selectedCountry)}</Text>
<Text style={styles.arrow}>⌄</Text>
        </Pressable>
        <Input
value={value}
onChangeText={onChangeText}
keyboardType="phone-pad"
placeholder={placeholder ?? 'Número de teléfono'}
style={styles.input}
        />
      </View>
      {value.trim() ? (
        <Text style={[styles.preview, normalized.valid ? styles.valid : styles.invalid]}>
{normalized.valid
  ? `Se guardará como ${normalized.display} · ${countryName(normalized.country)}`
  : `Número incompleto o no válido para ${countryName(selectedCountry)}.`}
        </Text>
      ) : null}
      {suggestion ? (
        <View style={styles.suggestion}>
<Text style={styles.suggestionText}>Parece un número de {countryName(suggestion.country)}: {suggestion.display}</Text>
<Button compact variant="secondary" label={`Usar ${countryName(suggestion.country)}`} onPress={() => {
  onCountryChange(suggestion.country);
  onChangeText(suggestion.e164);
}} />
        </View>
      ) : null}

      <AppModal visible={showCountries} title="Seleccionar país del número" onClose={() => setShowCountries(false)}>
        <Input placeholder="Buscar país o código…" value={query} onChangeText={setQuery} />
        <ScrollView style={styles.countryList}>
{filteredCountries.map((item) => (
  <Pressable key={item.country} onPress={() => {
    onCountryChange(item.country);
    setShowCountries(false);
    setQuery('');
  }} style={[styles.countryRow, item.country === selectedCountry && styles.countryRowActive]}>
    <Text style={styles.countryFlag}>{countryFlag(item.country)}</Text>
    <Text style={styles.countryName}>{item.name}</Text>
    <Text style={styles.countryCode}>{item.callingCode}</Text>
  </Pressable>
))}
        </ScrollView>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 12 },
  label: { color: colors.text, fontWeight: '700', fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  countryButton: { minHeight: 42, minWidth: 112, borderWidth: 1, borderColor: '#B9BEC5', borderRadius: 7, paddingHorizontal: 10, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 6 },
  flag: { fontSize: 17 },
  callingCode: { color: colors.text, fontWeight: '800', fontSize: 12 },
  arrow: { color: colors.muted, marginLeft: 'auto' },
  input: { flex: 1, marginBottom: 0 },
  preview: { fontSize: 10, marginTop: 5 },
  valid: { color: colors.success },
  invalid: { color: colors.danger },
  suggestion: { marginTop: 7, borderWidth: 1, borderColor: '#F2C66D', backgroundColor: colors.warningLight, borderRadius: 8, padding: 9, gap: 8, alignItems: 'flex-start' },
  suggestionText: { color: colors.text, fontSize: 10, lineHeight: 15 },
  countryList: { maxHeight: 430 },
  countryRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  countryRowActive: { backgroundColor: colors.primaryLight },
  countryFlag: { fontSize: 18 },
  countryName: { flex: 1, color: colors.text, fontWeight: '700' },
  countryCode: { color: colors.muted, fontWeight: '800' },
});
