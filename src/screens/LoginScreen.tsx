import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAppState } from '../state/AppState';
import { colors, roleLabels } from '../theme';
import { Button, Card, Input } from '../components/UI';

export function LoginScreen() {
  const { login, loginAs, users } = useAppState();
  const [email, setEmail] = useState('admin@demac.demo');
  const [password, setPassword] = useState('demac2026');
  const [error, setError] = useState('');

  const submit = () => {
    const result = login(email, password);
    if (!result.ok) setError(result.message ?? 'No fue posible iniciar sesión.');
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandPanel}>
          <View style={styles.logoMark}>
            <Text style={styles.logoSnow}>❄</Text>
          </View>
          <Text style={styles.brandName}>DEMAC</Text>
          <Text style={styles.brandCorporation}>CORPORATION</Text>
          <Text style={styles.slogan}>Professional Cooling Solutions</Text>
          <View style={styles.brandDivider} />
          <Text style={styles.brandCopy}>Una sola plataforma para administrar clientes, técnicos, ventas, inventario y operaciones.</Text>
          <View style={styles.featureList}>
            <Text style={styles.feature}>✓ Aplicación Android para técnicos</Text>
            <Text style={styles.feature}>✓ Plataforma web para oficina</Text>
            <Text style={styles.feature}>✓ Datos sincronizados y permisos por rol</Text>
          </View>
          <View style={styles.demoBadge}><Text style={styles.demoBadgeText}>ENTORNO DEMO</Text></View>
        </View>

        <Card style={styles.loginCard}>
          <Text style={styles.welcome}>Bienvenido</Text>
          <Text style={styles.loginSubtitle}>Inicia sesión en DEMAC Corporation</Text>
          <Input label="Correo electrónico" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Input label="Contraseña" secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Iniciar sesión" onPress={submit} />

          <View style={styles.quickSection}>
            <Text style={styles.quickTitle}>Accesos rápidos de prueba</Text>
            <Text style={styles.quickCopy}>Selecciona un perfil para revisar sus permisos.</Text>
            <View style={styles.quickGrid}>
              {users.map((user) => (
                <Pressable key={user.id} onPress={() => loginAs(user.id)} style={({ pressed }) => [styles.quickUser, pressed && { opacity: 0.75 }]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quickName} numberOfLines={1}>{user.name}</Text>
                    <Text style={styles.quickRole}>{roleLabels[user.role]}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, flexDirection: Platform.OS === 'web' ? 'row' : 'column', alignItems: 'stretch' },
  brandPanel: { flex: 1, minHeight: 380, backgroundColor: colors.primaryDark, padding: 44, justifyContent: 'center' },
  logoMark: { width: 66, height: 66, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  logoSnow: { fontSize: 38, color: colors.primary },
  brandName: { color: '#FFFFFF', fontWeight: '900', fontSize: 44, letterSpacing: 2 },
  brandCorporation: { color: '#8EC4FF', fontWeight: '900', fontSize: 15, letterSpacing: 6, marginTop: -2 },
  slogan: { color: '#FFFFFF', fontSize: 17, marginTop: 14, fontWeight: '700' },
  brandDivider: { width: 54, height: 4, backgroundColor: '#59A5FF', borderRadius: 2, marginVertical: 22 },
  brandCopy: { color: '#D7E7FA', lineHeight: 23, maxWidth: 480, fontSize: 15 },
  featureList: { gap: 10, marginTop: 22 },
  feature: { color: '#FFFFFF', fontWeight: '700' },
  demoBadge: { marginTop: 28, borderWidth: 1, borderColor: '#6BA9EB', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13, alignSelf: 'flex-start' },
  demoBadgeText: { color: '#BFDFFF', fontWeight: '900', letterSpacing: 1.4, fontSize: 11 },
  loginCard: { flex: 1, maxWidth: Platform.OS === 'web' ? 620 : undefined, borderRadius: 0, borderWidth: 0, padding: 38, justifyContent: 'center' },
  welcome: { fontSize: 30, fontWeight: '900', color: colors.text },
  loginSubtitle: { color: colors.muted, marginTop: 5, marginBottom: 26 },
  error: { backgroundColor: colors.dangerLight, color: colors.danger, borderRadius: 8, padding: 10, marginBottom: 12, fontWeight: '700' },
  quickSection: { marginTop: 30, paddingTop: 24, borderTopWidth: 1, borderTopColor: colors.border },
  quickTitle: { fontWeight: '900', color: colors.text, fontSize: 16 },
  quickCopy: { color: colors.muted, fontSize: 12, marginTop: 3, marginBottom: 12 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  quickUser: { width: Platform.OS === 'web' ? '48%' : '100%', minWidth: 215, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: '#FBFCFE', borderRadius: 12, padding: 10, gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '900', fontSize: 12 },
  quickName: { color: colors.text, fontWeight: '800', fontSize: 12 },
  quickRole: { color: colors.muted, fontSize: 10, marginTop: 2 },
});
