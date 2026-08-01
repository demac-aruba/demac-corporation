const fs = require('fs');

const marker = 'AGENDA_CREATION_MODAL_V6';
const targetFiles = [
  'src/components/UI.tsx',
  'src/screens/AgendaScreen.tsx',
];

const marked = targetFiles.filter((file) => fs.readFileSync(file, 'utf8').includes(marker));
if (marked.length === targetFiles.length) {
  console.log('patchAgendaCreationModalV6.cjs already applied.');
  process.exit(0);
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Could not find ${label}.`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`Found more than one ${label}.`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function update(file, transform) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(marker)) return;
  const next = transform(source);
  if (next === source) throw new Error(`No changes produced for ${file}.`);
  fs.writeFileSync(file, next);
}

update('src/components/UI.tsx', (source) => {
  source = replaceOnce(
    source,
    `export function AppModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useWebBackLayer(visible, onClose, \`modal:\${title}\`);
  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screenLayer}>
        <View style={styles.screenHeader}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.screenBackButton}>
            <Text style={styles.screenBackText}>‹ Volver</Text>
          </Pressable>
          <Text numberOfLines={2} style={styles.screenTitle}>{title}</Text>
          <View style={styles.screenHeaderSpacer} />
        </View>
        <View style={styles.screenBody}>{children}</View>
      </View>
    </Modal>
  );
}`,
    `export function AppModal({
  visible,
  title,
  onClose,
  children,
  presentation = 'screen',
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  presentation?: 'screen' | 'overlay';
}) {
  useWebBackLayer(visible, onClose, \`modal:\${title}\`);

  if (presentation === 'overlay') {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Pressable accessibilityLabel="Cerrar" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>×</Text>
              </Pressable>
            </View>
            {children}
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screenLayer}>
        <View style={styles.screenHeader}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.screenBackButton}>
            <Text style={styles.screenBackText}>‹ Volver</Text>
          </Pressable>
          <Text numberOfLines={2} style={styles.screenTitle}>{title}</Text>
          <View style={styles.screenHeaderSpacer} />
        </View>
        <View style={styles.screenBody}>{children}</View>
      </View>
    </Modal>
  );
}`,
    'AppModal presentation',
  );

  return replaceOnce(
    source,
    `  // APP_SCREEN_NAVIGATION_V5: action forms are dedicated app screens, never centered popups.
  screenLayer: { flex: 1, backgroundColor: colors.background },`,
    `  // APP_SCREEN_NAVIGATION_V5: action forms are dedicated app screens by default.
  // ${marker}: short agenda creation remains a centered overlay on desktop.
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(32,33,36,0.46)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', maxWidth: 760, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 19 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  modalTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800' },
  closeButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0F2F4', alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { fontSize: 23, lineHeight: 24, color: colors.text },
  screenLayer: { flex: 1, backgroundColor: colors.background },`,
    'AppModal presentation styles',
  );
});

update('src/screens/AgendaScreen.tsx', (source) => {
  source = replaceOnce(
    source,
    `      <AppModal
        visible={showCreate}
        title={showQuickClient ? 'Agregar cliente rápido' : showQuickProperty ? 'Añadir propiedad' : showQuickContact ? 'Añadir persona encargada' : editingOrder ? 'Editar cita' : reschedulingOrder ? 'Reprogramar cita' : 'Confirmar nueva cita'}`,
    `      {/* ${marker}: creating a new appointment stays over the calendar; existing appointment actions remain dedicated screens. */}
      <AppModal
        visible={showCreate}
        presentation={editingOrder || reschedulingOrder ? 'screen' : 'overlay'}
        title={showQuickClient ? 'Agregar cliente rápido' : showQuickProperty ? 'Añadir propiedad' : showQuickContact ? 'Añadir persona encargada' : editingOrder ? 'Editar cita' : reschedulingOrder ? 'Reprogramar cita' : 'Confirmar nueva cita'}`,
    'agenda creation presentation',
  );

  return replaceOnce(
    source,
    `      const result = await addWorkOrder(order);
      setSaving(false);
      if (!result.ok) return setFormMessage(result.message ?? 'No se pudo guardar la cita.');
      setSelectedOrderId(order.id);`,
    `      const result = await addWorkOrder(order);
      setSaving(false);
      if (!result.ok) return setFormMessage(result.message ?? 'No se pudo guardar la cita.');
      setSelectedOrderId(null);`,
    'new appointment post-save navigation',
  );
});

console.log('patchAgendaCreationModalV6.cjs applied.');
