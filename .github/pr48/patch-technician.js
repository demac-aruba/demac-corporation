const fs = require('fs');
const path = 'src/screens/TechnicianScreen.tsx';
let text = fs.readFileSync(path, 'utf8');
function replace(oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`${label} not found`);
  text = text.replace(oldText, newText);
}
replace("  requiresSecondVisit: boolean;\n};\n", "  requiresSecondVisit: boolean;\n  localPhotos: string[];\n};\n", 'draft type');
replace("  requiresSecondVisit: false,\n};\n", "  requiresSecondVisit: false,\n  localPhotos: [],\n};\n", 'empty draft');
replace("    requiresSecondVisit: order.requiresSecondVisit ?? false,\n  };\n", "    requiresSecondVisit: order.requiresSecondVisit ?? false,\n    localPhotos: [],\n  };\n", 'draft from order');
replace(
  "  const technicianIds = useMemo(() => [currentUser?.id, currentStaff?.id].filter(Boolean) as string[], [currentUser?.id, currentStaff?.id]);\n",
  "  const technicianIds = useMemo(() => [currentUser?.id, currentStaff?.id].filter(Boolean) as string[], [currentUser?.id, currentStaff?.id]);\n",
  'technician ids marker',
);
replace(
  "    if (changed) await AsyncStorage.removeItem(`${DRAFT_PREFIX}${selected.id}`);\n",
  "    if (changed) {\n      if (draft.localPhotos.length) {\n        setFormMessage('Trabajo completado. Las fotos temporales permanecen guardadas en este teléfono hasta que activemos Firebase Storage.');\n      } else {\n        await AsyncStorage.removeItem(`${DRAFT_PREFIX}${selected.id}`);\n      }\n    }\n",
  'complete cleanup',
);
replace(
  "      const updatedPhotos = [...(selected.photos ?? []), ...result.assets.map((asset) => asset.uri)];\n      const saved = await updateWorkOrder(selected.id, { photos: updatedPhotos });\n      setPhotoMessage(saved.ok ? 'Evidencia añadida. En el próximo módulo se almacenará permanentemente en Firebase Storage.' : saved.message ?? 'No se pudo adjuntar la foto.');\n",
  "      const localPhotos = result.assets.map((asset) => asset.uri);\n      setDraft((current) => ({ ...current, localPhotos: [...current.localPhotos, ...localPhotos] }));\n      setPhotoMessage(`${localPhotos.length} foto${localPhotos.length === 1 ? '' : 's'} guardada${localPhotos.length === 1 ? '' : 's'} temporalmente en este teléfono. Firebase Storage se activará en el módulo de evidencia permanente.`);\n",
  'photo persistence',
);
replace(
  "  const assignedNames = selected?.technicianIds\n    .map((id) => staffProfiles.find((staff) => staff.id === id)?.name ?? id)\n    .join(', ');\n",
  "  const assignedNames = selected?.technicianIds\n    .map((id) => staffProfiles.find((staff) => staff.id === id)?.name ?? id)\n    .join(', ');\n  const displayedPhotos = [...(selected?.photos ?? []), ...draft.localPhotos];\n",
  'displayed photos',
);
replace(
  "              <Text style={styles.photoLabel}>Evidencia temporal ({selected.photos?.length ?? 0})</Text>\n              <View style={styles.photoRow}>\n                {(selected.photos ?? []).map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={styles.photo} />)}\n              </View>\n",
  "              <Text style={styles.photoLabel}>Evidencia temporal ({displayedPhotos.length})</Text>\n              <View style={styles.photoRow}>\n                {displayedPhotos.map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={styles.photo} />)}\n              </View>\n              {draft.localPhotos.length ? <Text style={styles.helperText}>Estas fotos todavía están guardadas únicamente en este teléfono y no se enviarán a la oficina hasta activar Firebase Storage.</Text> : null}\n",
  'photo UI',
);
fs.writeFileSync(path, text);
