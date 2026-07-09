import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Pill, SectionTitle } from '../components/UI';
import { useAppState } from '../state/AppState';
import { colors, roleLabels } from '../theme';

export function SettingsScreen() {
  const { currentUser, users, resetDemo } = useAppState();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <SectionTitle title="Configuración del sistema" subtitle="Usuarios, permisos, empresa y herramientas del entorno DEMO." />
      <Card>
        <SectionTitle title="Información de la empresa" />
        <View style={styles.brandRow}><View style={styles.logo}><Text style={styles.logoText}>❄</Text></View><View><Text style={styles.name}>DEMAC</Text><Text style={styles.corporation}>CORPORATION</Text><Text style={styles.slogan}>Professional Cooling Solutions</Text></View></View>
        <View style={styles.infoGrid}><Info label="Administrador" value="Christian Alexander Márquez Márquez" /><Info label="Moneda" value="Florín arubeño (Afl.)" /><Info label="Zona horaria" value="America/Aruba" /><Info label="Plataformas" value="Android y Web" /></View>
      </Card>
      <Card>
        <SectionTitle title={`Usuarios DEMO (${users.length})`} subtitle="Estos registros se reemplazarán por el personal real durante la configuración final." />
        {users.map((user) => <View key={user.id} style={styles.userRow}><View style={styles.avatar}><Text style={styles.avatarText}>{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</Text></View><View style={{ flex: 1 }}><Text style={styles.userName}>{user.name}</Text><Text style={styles.userEmail}>{user.email}</Text></View><Pill label={roleLabels[user.role]} tone={user.id === currentUser?.id ? 'success' : 'info'} /></View>)}
      </Card>
      <Card>
        <SectionTitle title="Entorno de demostración" subtitle="La aplicación guarda localmente los cambios hechos durante las pruebas." />
        <View style={styles.warning}><Text style={styles.warningTitle}>Restablecer datos DEMO</Text><Text style={styles.warningText}>Elimina los cambios locales y vuelve a cargar clientes, citas, inventario e invoices originales.</Text><Button variant="danger" label="Restablecer información" onPress={() => { void resetDemo(); }} /></View>
      </Card>
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <View style={styles.info}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>; }
const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, paddingBottom: 90 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo: { width: 64, height: 64, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#FFFFFF', fontSize: 34 },
  name: { color: colors.text, fontWeight: '900', fontSize: 24, letterSpacing: 1.2 },
  corporation: { color: colors.primary, fontWeight: '900', fontSize: 9, letterSpacing: 4 },
  slogan: { color: colors.muted, fontWeight: '700', marginTop: 5 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 20, paddingTop: 17, borderTopWidth: 1, borderTopColor: colors.border },
  info: { flex: 1, minWidth: 190 },
  infoLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  infoValue: { color: colors.text, fontWeight: '800', fontSize: 12, marginTop: 5 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EDF1F6' },
  avatar: { width: 39, height: 39, borderRadius: 11, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 11 },
  userName: { color: colors.text, fontWeight: '900', fontSize: 12 },
  userEmail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  warning: { borderWidth: 1, borderColor: '#F3C8C8', backgroundColor: '#FFF8F8', borderRadius: 13, padding: 15, gap: 8, alignItems: 'flex-start' },
  warningTitle: { color: colors.danger, fontWeight: '900' },
  warningText: { color: colors.text, lineHeight: 19, marginBottom: 4 },
});
