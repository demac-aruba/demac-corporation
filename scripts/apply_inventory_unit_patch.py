from pathlib import Path

screen_path = Path('src/screens/InventoryScreenV4.tsx')
hook_path = Path('src/hooks/useInventoryModuleV2.ts')

screen = screen_path.read_text(encoding='utf-8')
hook = hook_path.read_text(encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

screen = replace_once(
    screen,
    """function makePhotoSlots(quantity: number, mode: ToolTrackingMode, previous: Array<PendingPhoto | null> = []) {
  const length = mode === 'individual' ? Math.max(1, quantity) : 1;
  return Array.from({ length }, (_, index) => previous[index] ?? null);
}
""",
    """function makePhotoSlots(quantity: number, mode: ToolTrackingMode, previous: Array<PendingPhoto | null> = []) {
  const length = mode === 'individual' ? Math.max(1, quantity) : 1;
  return Array.from({ length }, (_, index) => previous[index] ?? null);
}

function makeConditionSlots(quantity: number, mode: ToolTrackingMode, previous: ToolConditionV2[] = []) {
  const length = mode === 'individual' ? Math.max(1, quantity) : 1;
  return Array.from({ length }, (_, index) => previous[index] ?? 'Nueva');
}
""",
    'condition slot helper',
)

screen = replace_once(
    screen,
    """  const [toolName, setToolName] = useState('');
  const [toolCategory, setToolCategory] = useState<'Power Tools' | 'Hand Tools'>('Power Tools');
  const [toolCost, setToolCost] = useState('0');
  const [toolCondition, setToolCondition] = useState<ToolConditionV2>('Nueva');
  const [toolQuantity, setToolQuantity] = useState('1');
  const [recommendedQuantity, setRecommendedQuantity] = useState('1');
  const [toolPhotos, setToolPhotos] = useState<Array<PendingPhoto | null>>([null]);

  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [addCatalog, setAddCatalog] = useState<ToolCatalogItemV2 | null>(null);
  const [addQuantity, setAddQuantity] = useState('1');
  const [addCondition, setAddCondition] = useState<ToolConditionV2>('Nueva');
  const [addPhotos, setAddPhotos] = useState<Array<PendingPhoto | null>>([null]);
""",
    """  const [toolName, setToolName] = useState('');
  const [toolCategory, setToolCategory] = useState<'Power Tools' | 'Hand Tools'>('Power Tools');
  const [toolTrackingMode, setToolTrackingMode] = useState<ToolTrackingMode>('individual');
  const [toolCost, setToolCost] = useState('0');
  const [toolConditions, setToolConditions] = useState<ToolConditionV2[]>(['Nueva']);
  const [toolQuantity, setToolQuantity] = useState('1');
  const [recommendedQuantity, setRecommendedQuantity] = useState('1');
  const [toolPhotos, setToolPhotos] = useState<Array<PendingPhoto | null>>([null]);

  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [addCatalog, setAddCatalog] = useState<ToolCatalogItemV2 | null>(null);
  const [addQuantity, setAddQuantity] = useState('1');
  const [addConditions, setAddConditions] = useState<ToolConditionV2[]>(['Nueva']);
  const [addPhotos, setAddPhotos] = useState<Array<PendingPhoto | null>>([null]);
""",
    'registration state',
)

screen = replace_once(
    screen,
    "  const toolTrackingMode: ToolTrackingMode = toolCategory === 'Power Tools' ? 'individual' : 'quantity';\n",
    '',
    'derived tracking mode',
)

screen = replace_once(
    screen,
    """  useEffect(() => {
    setToolPhotos((previous) => makePhotoSlots(registrationQuantity, toolTrackingMode, previous));
  }, [registrationQuantity, toolTrackingMode]);

  useEffect(() => {
    if (!addCatalog) return;
    setAddPhotos((previous) => makePhotoSlots(additionQuantity, addCatalog.trackingMode ?? 'individual', previous));
  }, [additionQuantity, addCatalog]);
""",
    """  useEffect(() => {
    setToolPhotos((previous) => makePhotoSlots(registrationQuantity, toolTrackingMode, previous));
    setToolConditions((previous) => makeConditionSlots(registrationQuantity, toolTrackingMode, previous));
  }, [registrationQuantity, toolTrackingMode]);

  useEffect(() => {
    if (!addCatalog) return;
    const mode = addCatalog.trackingMode ?? 'individual';
    setAddPhotos((previous) => makePhotoSlots(additionQuantity, mode, previous));
    setAddConditions((previous) => makeConditionSlots(additionQuantity, mode, previous));
  }, [additionQuantity, addCatalog]);
""",
    'slot effects',
)

screen = replace_once(
    screen,
    """    setToolName('');
    setToolCategory('Power Tools');
    setToolCost('0');
    setToolCondition('Nueva');
    setToolQuantity('1');
    setRecommendedQuantity('1');
    setToolPhotos([null]);
""",
    """    setToolName('');
    setToolCategory('Power Tools');
    setToolTrackingMode('individual');
    setToolCost('0');
    setToolConditions(['Nueva']);
    setToolQuantity('1');
    setRecommendedQuantity('1');
    setToolPhotos([null]);
""",
    'reset form',
)

screen = replace_once(
    screen,
    """        initialVanId: selectedVanId,
        condition: toolCondition,
        trackingMode: toolTrackingMode,
        quantity: registrationQuantity,
""",
    """        initialVanId: selectedVanId,
        condition: toolConditions[0] ?? 'Nueva',
        conditions: toolConditions,
        trackingMode: toolTrackingMode,
        quantity: registrationQuantity,
""",
    'create tool conditions',
)

screen = replace_once(
    screen,
    """    setAddQuantity(String(Math.max(1, suggestedQuantity)));
    setAddCondition('Nueva');
    setAddPhotos([null]);
""",
    """    setAddQuantity(String(Math.max(1, suggestedQuantity)));
    setAddConditions(['Nueva']);
    setAddPhotos([null]);
""",
    'reset add units',
)

screen = replace_once(
    screen,
    """        catalogId: addCatalog.id,
        vanId: selectedVan.id,
        condition: addCondition,
        quantity: additionQuantity,
""",
    """        catalogId: addCatalog.id,
        vanId: selectedVan.id,
        condition: addConditions[0] ?? 'Nueva',
        conditions: addConditions,
        quantity: additionQuantity,
""",
    'add unit conditions',
)

screen = replace_once(
    screen,
    """          <Text style={styles.cardText}>Completa únicamente la información de la nueva herramienta. El tipo de control se asigna automáticamente según la categoría.</Text>
          <Input label="Nombre de la herramienta" value={toolName} onChangeText={setToolName} placeholder="Ej. Makita Impact Driver" />
          <Text style={styles.smallLabel}>CATEGORÍA</Text>
          <View style={styles.optionRow}>
            <Button compact variant={toolCategory === 'Power Tools' ? 'primary' : 'secondary'} label="Power Tools" onPress={() => setToolCategory('Power Tools')} />
            <Button compact variant={toolCategory === 'Hand Tools' ? 'primary' : 'secondary'} label="Hand Tools" onPress={() => setToolCategory('Hand Tools')} />
          </View>
          <View style={styles.autoModeBox}>
            <Text style={styles.autoModeTitle}>{toolCategory === 'Power Tools' ? 'Registro por unidad física' : 'Registro por cantidad'}</Text>
            <Text style={styles.cardText}>{toolCategory === 'Power Tools' ? 'Cada máquina tendrá foto, código e historial independiente.' : 'Las herramientas pequeñas se administrarán mediante cantidades.'}</Text>
          </View>
          <View style={styles.formGrid}>
            <Input style={styles.field} keyboardType="numeric" label="Costo por unidad Afl." value={toolCost} onChangeText={setToolCost} />
            <Input style={styles.field} keyboardType="numeric" label="Cantidad en esta van" value={toolQuantity} onChangeText={setToolQuantity} />
            <Input style={styles.field} keyboardType="numeric" label="Cantidad estándar recomendada" value={recommendedQuantity} onChangeText={setRecommendedQuantity} />
          </View>
          <Text style={styles.smallLabel}>ESTADO INICIAL</Text>
          <View style={styles.optionRow}>
            {CONDITIONS.map((condition) => <Button key={condition} compact variant={toolCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setToolCondition(condition)} />)}
          </View>
          <PhotoSlots
            title={toolTrackingMode === 'individual' ? 'Fotografía obligatoria por unidad' : 'Fotografía general obligatoria'}
            slots={toolPhotos}
            mode={toolTrackingMode}
            onCamera={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, true)}
            onGallery={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, false)}
          />
""",
    """          <Text style={styles.cardText}>Registra las piezas una por una cuando necesiten foto, condición e historial propios. Usa grupo por cantidad solamente para artículos pequeños e intercambiables.</Text>
          <Input label="Nombre de la herramienta" value={toolName} onChangeText={setToolName} placeholder="Ej. Core drill bit" />
          <Text style={styles.smallLabel}>CATEGORÍA</Text>
          <View style={styles.optionRow}>
            <Button compact variant={toolCategory === 'Power Tools' ? 'primary' : 'secondary'} label="Power Tools" onPress={() => setToolCategory('Power Tools')} />
            <Button compact variant={toolCategory === 'Hand Tools' ? 'primary' : 'secondary'} label="Hand Tools" onPress={() => setToolCategory('Hand Tools')} />
          </View>
          <Text style={styles.smallLabel}>FORMA DE REGISTRO</Text>
          <View style={styles.optionRow}>
            <Button compact variant={toolTrackingMode === 'individual' ? 'primary' : 'secondary'} label="Por unidad" onPress={() => setToolTrackingMode('individual')} />
            <Button compact variant={toolTrackingMode === 'quantity' ? 'primary' : 'secondary'} label="Grupo por cantidad" onPress={() => setToolTrackingMode('quantity')} />
          </View>
          <View style={styles.autoModeBox}>
            <Text style={styles.autoModeTitle}>{toolTrackingMode === 'individual' ? 'Una ficha por cada pieza física' : 'Un solo grupo contado'}</Text>
            <Text style={styles.cardText}>{toolTrackingMode === 'individual' ? 'La cantidad indicada generará la misma cantidad de fotos, condiciones y códigos internos.' : 'Todas las piezas compartirán una foto y una condición general.'}</Text>
          </View>
          <View style={styles.formGrid}>
            <Input style={styles.field} keyboardType="numeric" label="Costo por unidad Afl." value={toolCost} onChangeText={setToolCost} />
            <Input style={styles.field} keyboardType="numeric" label="Cantidad en esta van" value={toolQuantity} onChangeText={setToolQuantity} />
            <Input style={styles.field} keyboardType="numeric" label="Cantidad estándar recomendada" value={recommendedQuantity} onChangeText={setRecommendedQuantity} />
          </View>
          <PhotoSlots
            title={toolTrackingMode === 'individual' ? `${registrationQuantity} fotografía${registrationQuantity === 1 ? '' : 's'} y estado por unidad` : 'Fotografía y estado general del grupo'}
            slots={toolPhotos}
            conditions={toolConditions}
            mode={toolTrackingMode}
            onConditionChange={(index, condition) => setToolConditions((previous) => previous.map((candidate, candidateIndex) => candidateIndex === index ? condition : candidate))}
            onCamera={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, true)}
            onGallery={(index) => void replacePhoto(toolPhotos, setToolPhotos, index, false)}
          />
""",
    'new tool modal',
)

screen = replace_once(
    screen,
    """            <Text style={styles.cardText}>Se asignará únicamente a {selectedVan?.name}.</Text>
            <Input keyboardType="numeric" label="Cantidad a asignar" value={addQuantity} onChangeText={setAddQuantity} />
            <Text style={styles.smallLabel}>ESTADO INICIAL</Text>
            <View style={styles.optionRow}>
              {CONDITIONS.map((condition) => <Button key={condition} compact variant={addCondition === condition ? 'primary' : 'secondary'} label={condition} onPress={() => setAddCondition(condition)} />)}
            </View>
            <PhotoSlots
              title={(addCatalog.trackingMode ?? 'individual') === 'individual' ? 'Una fotografía por unidad' : 'Fotografía general'}
              slots={addPhotos}
              mode={addCatalog.trackingMode ?? 'individual'}
              onCamera={(index) => void replacePhoto(addPhotos, setAddPhotos, index, true)}
              onGallery={(index) => void replacePhoto(addPhotos, setAddPhotos, index, false)}
            />
""",
    """            <Text style={styles.cardText}>Se asignará únicamente a {selectedVan?.name}. Las unidades individuales conservan foto y condición propias.</Text>
            <Input keyboardType="numeric" label="Cantidad a asignar" value={addQuantity} onChangeText={setAddQuantity} />
            <PhotoSlots
              title={(addCatalog.trackingMode ?? 'individual') === 'individual' ? `${additionQuantity} fotografía${additionQuantity === 1 ? '' : 's'} y estado por unidad` : 'Fotografía y estado general del grupo'}
              slots={addPhotos}
              conditions={addConditions}
              mode={addCatalog.trackingMode ?? 'individual'}
              onConditionChange={(index, condition) => setAddConditions((previous) => previous.map((candidate, candidateIndex) => candidateIndex === index ? condition : candidate))}
              onCamera={(index) => void replacePhoto(addPhotos, setAddPhotos, index, true)}
              onGallery={(index) => void replacePhoto(addPhotos, setAddPhotos, index, false)}
            />
""",
    'add units modal',
)

screen = replace_once(
    screen,
    """function PhotoSlots({ title, slots, mode, onCamera, onGallery }: { title: string; slots: Array<PendingPhoto | null>; mode: ToolTrackingMode; onCamera: (index: number) => void; onGallery: (index: number) => void }) {
  return (
    <View style={styles.photoSection}>
      <Text style={styles.smallLabel}>{title.toUpperCase()}</Text>
      <View style={styles.photoGrid}>
        {slots.map((photo, index) => (
          <View key={index} style={styles.photoSlot}>
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : <View style={styles.photoPlaceholder}><Text>{mode === 'individual' ? `Unidad ${index + 1}` : 'Foto general'}</Text></View>}
            <View style={styles.optionRow}><Button compact variant="secondary" label="Cámara" onPress={() => onCamera(index)} /><Button compact variant="secondary" label="Galería" onPress={() => onGallery(index)} /></View>
          </View>
        ))}
      </View>
    </View>
  );
}
""",
    """function PhotoSlots({ title, slots, conditions, mode, onConditionChange, onCamera, onGallery }: { title: string; slots: Array<PendingPhoto | null>; conditions: ToolConditionV2[]; mode: ToolTrackingMode; onConditionChange: (index: number, condition: ToolConditionV2) => void; onCamera: (index: number) => void; onGallery: (index: number) => void }) {
  return (
    <View style={styles.photoSection}>
      <Text style={styles.smallLabel}>{title.toUpperCase()}</Text>
      <View style={styles.photoGrid}>
        {slots.map((photo, index) => (
          <View key={index} style={styles.photoSlot}>
            <Text style={styles.photoUnitTitle}>{mode === 'individual' ? `Unidad ${index + 1} de ${slots.length}` : 'Grupo completo'}</Text>
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : <View style={styles.photoPlaceholder}><Text>{mode === 'individual' ? `Foto de unidad ${index + 1}` : 'Foto general'}</Text></View>}
            <View style={styles.optionRow}><Button compact variant="secondary" label="Cámara" onPress={() => onCamera(index)} /><Button compact variant="secondary" label="Galería" onPress={() => onGallery(index)} /></View>
            <View style={styles.unitConditionBox}>
              <Text style={styles.smallLabel}>{mode === 'individual' ? `ESTADO DE UNIDAD ${index + 1}` : 'ESTADO GENERAL'}</Text>
              <View style={styles.optionRow}>
                {CONDITIONS.map((condition) => <Button key={condition} compact variant={(conditions[index] ?? 'Nueva') === condition ? 'primary' : 'secondary'} label={condition} onPress={() => onConditionChange(index, condition)} />)}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
""",
    'photo slots component',
)

screen = replace_once(
    screen,
    """  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoSlot: { width: 220, gap: 7 },
  photoPlaceholder: { height: 145, borderWidth: 1, borderColor: colors.border, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFBFC' },
""",
    """  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoSlot: { flexGrow: 1, flexBasis: 240, minWidth: 220, maxWidth: 340, gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 10, backgroundColor: '#FFFFFF' },
  photoUnitTitle: { color: colors.text, fontWeight: '900', fontSize: 12 },
  unitConditionBox: { gap: 4, paddingTop: 2 },
  photoPlaceholder: { height: 145, borderWidth: 1, borderColor: colors.border, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFBFC' },
""",
    'photo styles',
)

hook = replace_once(
    hook,
    """  condition: ToolConditionV2;
  trackingMode: ToolTrackingMode;
""",
    """  condition: ToolConditionV2;
  conditions?: ToolConditionV2[];
  trackingMode: ToolTrackingMode;
""",
    'create input conditions',
)

hook = replace_once(
    hook,
    """  condition: ToolConditionV2;
  quantity: number;
};
""",
    """  condition: ToolConditionV2;
  conditions?: ToolConditionV2[];
  quantity: number;
};
""",
    'add input conditions',
)

hook = replace_once(
    hook,
    """  function buildIndividualAssets(catalog: ToolCatalogItemV2, van: Van, quantity: number, condition: ToolConditionV2) {
    const now = new Date().toISOString();
    const firstUnit = nextUnitNumber(catalog.id);
    return Array.from({ length: quantity }, (_, index): VanToolAssetV2 => {
      const unitNumber = firstUnit + index;
      return {
""",
    """  function buildIndividualAssets(catalog: ToolCatalogItemV2, van: Van, quantity: number, conditions: ToolConditionV2 | ToolConditionV2[]) {
    const now = new Date().toISOString();
    const firstUnit = nextUnitNumber(catalog.id);
    const conditionList = Array.isArray(conditions) ? conditions : [conditions];
    return Array.from({ length: quantity }, (_, index): VanToolAssetV2 => {
      const unitNumber = firstUnit + index;
      const condition = conditionList[index] ?? conditionList[0] ?? 'Nueva';
      return {
""",
    'individual asset builder',
)

hook = replace_once(
    hook,
    """      const assets = input.trackingMode === 'individual'
        ? buildIndividualAssets(catalog, van, quantity, input.condition)
        : [buildQuantityAsset(catalog, van, quantity, input.condition)];
""",
    """      const assets = input.trackingMode === 'individual'
        ? buildIndividualAssets(catalog, van, quantity, input.conditions?.length ? input.conditions : input.condition)
        : [buildQuantityAsset(catalog, van, quantity, input.conditions?.[0] ?? input.condition)];
""",
    'create asset conditions',
)

hook = replace_once(
    hook,
    """          : buildQuantityAsset(catalog, van, quantity, input.condition);
""",
    """          : buildQuantityAsset(catalog, van, quantity, input.conditions?.[0] ?? input.condition);
""",
    'quantity add condition',
)

hook = replace_once(
    hook,
    """      const assets = buildIndividualAssets(catalog, van, quantity, input.condition);
""",
    """      const assets = buildIndividualAssets(catalog, van, quantity, input.conditions?.length ? input.conditions : input.condition);
""",
    'individual add conditions',
)

for forbidden in ('toolCondition', 'setToolCondition', 'addCondition', 'setAddCondition'):
    if forbidden in screen:
        raise RuntimeError(f'old state reference remains: {forbidden}')

screen_path.write_text(screen, encoding='utf-8')
hook_path.write_text(hook, encoding='utf-8')
print('Inventory per-unit photo and condition patch applied.')
