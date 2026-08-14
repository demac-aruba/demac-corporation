import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useAppState } from '../state/AppState';
import { colors } from '../theme';
import {
  createMarketingUploadSession,
  listMarketingAssets,
  listMarketingUploadSessions,
  MarketingAsset,
  MarketingCampaignType,
  MarketingUploadSession,
  saveMarketingAsset,
  updateMarketingUploadSession,
  uploadMarketingAssetImage,
} from '../services/marketingStorage';

type MarketingTab = 'agent' | 'library' | 'campaigns' | 'brand' | 'approved';

type PickedMarketingAsset = {
  uri: string;
  fileName: string;
  mimeType?: string | null;
  cleanup?: () => void;
};

const campaignLabels: Record<MarketingCampaignType, string> = {
  otro_cliente_contento: 'Otro Cliente Contento',
  airco_sales: 'Venta de Aircos',
  installation: 'Instalación',
  service: 'Service',
  seasonal_heat: 'Temporada di Calor',
  other: 'Otro',
};

const tabs: { key: MarketingTab; label: string; icon: string }[] = [
  { key: 'agent', label: 'Marketing Agent', icon: '✦' },
  { key: 'library', label: 'Media Library', icon: '▦' },
  { key: 'campaigns', label: 'Campaigns', icon: '◎' },
  { key: 'brand', label: 'Brand Center', icon: '◆' },
  { key: 'approved', label: 'Approved', icon: '✓' },
];

function makeId(prefix: string) {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sessionDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function MarketingScreen() {
  const { currentUser } = useAppState();
  const { width } = useWindowDimensions();
  const compact = width < 860;
  const [activeTab, setActiveTab] = useState<MarketingTab>('library');
  const [sessions, setSessions] = useState<MarketingUploadSession[]>([]);
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [sessionName, setSessionName] = useState('');
  const [campaignType, setCampaignType] = useState<MarketingCampaignType>('otro_cliente_contento');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [loadError, setLoadError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const [nextSessions, nextAssets] = await Promise.all([
        listMarketingUploadSessions(),
        listMarketingAssets(),
      ]);
      setSessions(nextSessions);
      setAssets(nextAssets);
      setSelectedSessionId((current) => current ?? nextSessions[0]?.id);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar Marketing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId),
    [sessions, selectedSessionId],
  );
  const selectedAssets = useMemo(
    () => selectedSessionId ? assets.filter((asset) => asset.sessionId === selectedSessionId) : assets,
    [assets, selectedSessionId],
  );
  const approvedAssets = useMemo(() => assets.filter((asset) => asset.status === 'approved'), [assets]);

  const startUpload = useCallback(async (pickedAssets: PickedMarketingAsset[]) => {
    if (!pickedAssets.length || uploading) return;
    if (!currentUser) {
      Alert.alert('Sesión requerida', 'Inicia sesión nuevamente antes de subir imágenes.');
      return;
    }

    const now = new Date().toISOString();
    const uploadSessionId = makeId('marketing-session');
    const finalName = sessionName.trim() || `${campaignLabels[campaignType]} - ${new Date().toLocaleDateString()}`;
    const session: MarketingUploadSession = {
      id: uploadSessionId,
      name: finalName,
      campaignType,
      status: 'uploading',
      expectedAssetCount: pickedAssets.length,
      uploadedAssetCount: 0,
      failedAssetCount: 0,
      createdAt: now,
      updatedAt: now,
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
    };

    setUploading(true);
    setUploadDone(0);
    setUploadTotal(pickedAssets.length);
    let succeeded = 0;
    let failed = 0;

    try {
      await createMarketingUploadSession(session);
      setSelectedSessionId(uploadSessionId);

      for (const picked of pickedAssets) {
        const assetId = makeId('marketing-asset');
        try {
          const stored = await uploadMarketingAssetImage({
            uri: picked.uri,
            sessionId: uploadSessionId,
            assetId,
            fileName: picked.fileName,
            mimeType: picked.mimeType,
          });
          const assetNow = new Date().toISOString();
          await saveMarketingAsset({
            id: assetId,
            sessionId: uploadSessionId,
            originalFileName: picked.fileName,
            contentType: stored.contentType,
            sizeBytes: stored.sizeBytes,
            storagePath: stored.storagePath,
            downloadUrl: stored.downloadUrl,
            thumbnailStoragePath: stored.thumbnailStoragePath,
            thumbnailUrl: stored.thumbnailUrl,
            status: 'analysis_pending',
            createdAt: assetNow,
            updatedAt: assetNow,
            uploadedByUserId: currentUser.id,
          });
          succeeded += 1;
        } catch (error) {
          failed += 1;
          console.warn('Marketing upload failed:', picked.fileName, error);
        } finally {
          setUploadDone((value) => value + 1);
        }
      }

      const finalStatus = succeeded === pickedAssets.length ? 'ready' : succeeded > 0 ? 'partial' : 'failed';
      await updateMarketingUploadSession(uploadSessionId, {
        status: finalStatus,
        uploadedAssetCount: succeeded,
        failedAssetCount: failed,
        updatedAt: new Date().toISOString(),
      });
      setSessionName('');
      await refresh();
      Alert.alert(
        succeeded ? 'Upload completado' : 'Upload fallido',
        succeeded
          ? `${succeeded} imagen${succeeded === 1 ? '' : 'es'} lista${succeeded === 1 ? '' : 's'} para análisis.${failed ? ` ${failed} no pudieron subirse.` : ''}`
          : 'No se pudo subir ninguna imagen. Revisa la configuración de Firebase y vuelve a intentar.',
      );
    } catch (error) {
      Alert.alert('No se pudo crear la sesión', error instanceof Error ? error.message : 'Error inesperado.');
    } finally {
      pickedAssets.forEach((asset) => asset.cleanup?.());
      setUploading(false);
    }
  }, [campaignType, currentUser, refresh, sessionName, uploading]);

  const openWebPicker = useCallback((folderMode: boolean) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.multiple = true;
    if (folderMode) input.setAttribute('webkitdirectory', '');
    input.onchange = () => {
      const files = Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
      const picked = files.map((file) => {
        const uri = URL.createObjectURL(file);
        return {
          uri,
          fileName: file.name,
          mimeType: file.type || undefined,
          cleanup: () => URL.revokeObjectURL(uri),
        } satisfies PickedMarketingAsset;
      });
      void startUpload(picked);
    };
    input.click();
  }, [startUpload]);

  const openMobilePicker = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a tus fotos para subirlas a Marketing.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return;
    const picked = result.assets.map((asset, index) => ({
      uri: asset.uri,
      fileName: asset.fileName || `marketing-${Date.now()}-${index + 1}.jpg`,
      mimeType: asset.mimeType,
    }));
    await startUpload(picked);
  }, [startUpload]);

  const chooseImages = useCallback(() => {
    if (Platform.OS === 'web') openWebPicker(false);
    else void openMobilePicker();
  }, [openMobilePicker, openWebPicker]);

  const handleDroppedFiles = useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    event.preventDefault?.();
    const files = Array.from((event.dataTransfer?.files ?? []) as File[])
      .filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
    const picked = files.map((file) => {
      const uri = URL.createObjectURL(file);
      return {
        uri,
        fileName: file.name,
        mimeType: file.type || undefined,
        cleanup: () => URL.revokeObjectURL(uri),
      } satisfies PickedMarketingAsset;
    });
    void startUpload(picked);
  }, [startUpload]);

  const webDropProps = Platform.OS === 'web'
    ? ({
      onDragOver: (event: any) => event.preventDefault?.(),
      onDrop: handleDroppedFiles,
    } as any)
    : {};

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>DEMAC AI WORKSPACE</Text>
          <Text style={styles.title}>Marketing</Text>
          <Text style={styles.subtitle}>Media, campañas, reglas de marca y el futuro Marketing Agent en un solo lugar.</Text>
        </View>
        <View style={styles.headerBadge}><Text style={styles.headerBadgeText}>MVP FOUNDATION</Text></View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((tab) => (
          <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={[styles.tab, activeTab === tab.key && styles.tabActive]}>
            <Text style={[styles.tabIcon, activeTab === tab.key && styles.tabTextActive]}>{tab.icon}</Text>
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {activeTab === 'agent' ? <AgentHome sessions={sessions} assets={assets} /> : null}
        {activeTab === 'library' ? (
          <View style={[styles.libraryLayout, compact && styles.libraryLayoutCompact]}>
            <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
              <Text style={styles.sectionTitle}>Nueva sesión</Text>
              <Text style={styles.fieldLabel}>Nombre</Text>
              <TextInput
                value={sessionName}
                onChangeText={setSessionName}
                placeholder="Ej. Instalaciones 13 Agosto"
                placeholderTextColor="#98A2B3"
                style={styles.input}
                editable={!uploading}
              />
              <Text style={styles.fieldLabel}>Tipo de campaña</Text>
              <View style={styles.campaignChips}>
                {(Object.keys(campaignLabels) as MarketingCampaignType[]).map((key) => (
                  <Pressable key={key} disabled={uploading} onPress={() => setCampaignType(key)} style={[styles.chip, campaignType === key && styles.chipActive]}>
                    <Text style={[styles.chipText, campaignType === key && styles.chipTextActive]}>{campaignLabels[key]}</Text>
                  </Pressable>
                ))}
              </View>

              <View {...webDropProps} style={[styles.dropZone, uploading && styles.dropZoneBusy]}>
                <Text style={styles.dropIcon}>⬆</Text>
                <Text style={styles.dropTitle}>{uploading ? `Subiendo ${uploadDone}/${uploadTotal}` : 'Subir imágenes'}</Text>
                <Text style={styles.dropHelp}>{Platform.OS === 'web' ? 'Arrastra fotos aquí o selecciónalas.' : 'Selecciona varias fotos desde tu galería.'}</Text>
                {uploading ? (
                  <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${uploadTotal ? Math.round((uploadDone / uploadTotal) * 100) : 0}%` }]} /></View>
                ) : (
                  <View style={styles.uploadActions}>
                    <Pressable onPress={chooseImages} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Seleccionar fotos</Text></Pressable>
                    {Platform.OS === 'web' ? <Pressable onPress={() => openWebPicker(true)} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Subir carpeta</Text></Pressable> : null}
                  </View>
                )}
              </View>

              <View style={styles.divider} />
              <View style={styles.sidebarHeadingRow}>
                <Text style={styles.sectionTitle}>Sesiones recientes</Text>
                <Pressable onPress={() => void refresh()}><Text style={styles.refreshText}>Actualizar</Text></Pressable>
              </View>
              {loading ? <Text style={styles.muted}>Cargando…</Text> : null}
              {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
              {!loading && !sessions.length ? <Text style={styles.muted}>Todavía no hay uploads de marketing.</Text> : null}
              {sessions.slice(0, 12).map((session) => (
                <Pressable key={session.id} onPress={() => setSelectedSessionId(session.id)} style={[styles.sessionCard, selectedSessionId === session.id && styles.sessionCardActive]}>
                  <View style={styles.sessionTopRow}>
                    <Text style={styles.sessionName} numberOfLines={1}>{session.name}</Text>
                    <StatusPill status={session.status} />
                  </View>
                  <Text style={styles.sessionMeta}>{campaignLabels[session.campaignType]} · {session.uploadedAssetCount}/{session.expectedAssetCount} fotos</Text>
                  <Text style={styles.sessionDate}>{sessionDate(session.createdAt)}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.libraryMain}>
              <View style={styles.libraryHeader}>
                <View>
                  <Text style={styles.sectionTitle}>{selectedSession?.name ?? 'Media Library'}</Text>
                  <Text style={styles.muted}>{selectedSession ? `${selectedAssets.length} imágenes almacenadas · originales preservados` : 'Selecciona una sesión para revisar sus fotos.'}</Text>
                </View>
                {selectedSession ? (
                  <Pressable disabled={!selectedAssets.length} style={[styles.analyzeButton, !selectedAssets.length && styles.buttonDisabled]} onPress={() => Alert.alert('Siguiente fase', 'La Media Library ya está preparada. El análisis visual automático se conectará en V1B.') }>
                    <Text style={styles.analyzeButtonText}>✦ Analyze with Marketing Agent</Text>
                  </Pressable>
                ) : null}
              </View>

              {!selectedAssets.length ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>▧</Text>
                  <Text style={styles.emptyTitle}>No hay imágenes en esta sesión</Text>
                  <Text style={styles.emptyHelp}>Crea una sesión y sube fotos reales para probar el flujo de Media Library.</Text>
                </View>
              ) : (
                <View style={styles.mediaGrid}>
                  {selectedAssets.map((asset) => <AssetCard key={asset.id} asset={asset} />)}
                </View>
              )}
            </View>
          </View>
        ) : null}
        {activeTab === 'campaigns' ? <CampaignsFoundation /> : null}
        {activeTab === 'brand' ? <BrandFoundation /> : null}
        {activeTab === 'approved' ? <ApprovedFoundation assets={approvedAssets} /> : null}
      </ScrollView>
    </View>
  );
}

function AgentHome({ sessions, assets }: { sessions: MarketingUploadSession[]; assets: MarketingAsset[] }) {
  const readySessions = sessions.filter((session) => session.status === 'ready').length;
  return (
    <View style={styles.foundationWrap}>
      <View style={styles.heroCard}>
        <Text style={styles.heroKicker}>DEMAC MARKETING AGENT</Text>
        <Text style={styles.heroTitle}>La base operativa ya vive dentro del ERP.</Text>
        <Text style={styles.heroText}>Esta fase recibe y organiza media. La siguiente conectará análisis de fotos, Papiamento, dirección de arte, generación, QA y autocorrección.</Text>
      </View>
      <View style={styles.metricsRow}>
        <Metric label="Upload sessions" value={String(sessions.length)} />
        <Metric label="Assets" value={String(assets.length)} />
        <Metric label="Ready for analysis" value={String(readySessions)} />
      </View>
      <View style={styles.pipelineCard}>
        <Text style={styles.sectionTitle}>Pipeline</Text>
        {[
          ['Media Library + originals', true],
          ['Upload sessions + metadata', true],
          ['Image analysis + ranking', false],
          ['Papiamento validation', false],
          ['Art direction + rendering', false],
          ['Visual QA + auto-revision', false],
        ].map(([label, complete]) => (
          <View key={String(label)} style={styles.pipelineRow}>
            <View style={[styles.pipelineDot, complete ? styles.pipelineDotDone : styles.pipelineDotPending]}><Text style={styles.pipelineDotText}>{complete ? '✓' : '○'}</Text></View>
            <Text style={styles.pipelineLabel}>{label}</Text>
            <Text style={[styles.pipelineState, complete ? styles.pipelineStateDone : styles.pipelineStatePending]}>{complete ? 'READY' : 'NEXT'}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CampaignsFoundation() {
  return (
    <View style={styles.foundationWrap}>
      <Text style={styles.sectionTitle}>Campaign Library</Text>
      <Text style={styles.muted}>Tipos iniciales que el agente reconocerá y aplicará automáticamente.</Text>
      <View style={styles.foundationGrid}>
        {(Object.keys(campaignLabels) as MarketingCampaignType[]).filter((key) => key !== 'other').map((key) => (
          <View key={key} style={styles.foundationCard}>
            <Text style={styles.foundationCardTag}>CAMPAIGN TEMPLATE</Text>
            <Text style={styles.foundationCardTitle}>{campaignLabels[key]}</Text>
            <Text style={styles.foundationCardText}>Estructura preparada para incorporar reglas, copy, composición y QA específicos.</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function BrandFoundation() {
  return (
    <View style={styles.foundationWrap}>
      <Text style={styles.sectionTitle}>Brand Center</Text>
      <Text style={styles.muted}>Reglas iniciales visibles para validar que el agente está trabajando con la identidad correcta.</Text>
      <View style={styles.brandRules}>
        <Rule label="Brand" value="DEMAC Professional Cooling Solutions" />
        <Rule label="Primary color" value="Royal Blue" />
        <Rule label="Default language" value="Papiamento" />
        <Rule label="Primary CTA" value="WhatsApp" />
        <Rule label="WhatsApp" value="564-26-25" />
        <Rule label="Default format" value="1:1 square · high resolution" />
        <Rule label="Footer rule" value="Reserve clean bottom margin; never recreate the original footer" />
        <Rule label="Real photos" value="Preserve authenticity and the installed equipment" />
      </View>
    </View>
  );
}

function ApprovedFoundation({ assets }: { assets: MarketingAsset[] }) {
  return (
    <View style={styles.foundationWrap}>
      <Text style={styles.sectionTitle}>Approved Creatives</Text>
      <Text style={styles.muted}>Los creativos que superen QA aparecerán aquí cuando conectemos el Creative Engine.</Text>
      {!assets.length ? <View style={styles.emptyState}><Text style={styles.emptyIcon}>✓</Text><Text style={styles.emptyTitle}>Todavía no hay creativos aprobados</Text><Text style={styles.emptyHelp}>Esta sección ya está reservada para V1C/V1D.</Text></View> : null}
    </View>
  );
}

function AssetCard({ asset }: { asset: MarketingAsset }) {
  return (
    <View style={styles.assetCard}>
      <View style={styles.assetPreview}>
        <Image source={{ uri: asset.thumbnailUrl || asset.downloadUrl }} style={styles.assetImage} resizeMode="cover" />
        <View style={styles.assetStatus}><Text style={styles.assetStatusText}>ANALYSIS PENDING</Text></View>
      </View>
      <Text style={styles.assetName} numberOfLines={1}>{asset.originalFileName}</Text>
      <Text style={styles.assetMeta}>{formatBytes(asset.sizeBytes)} · original stored</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function Rule({ label, value }: { label: string; value: string }) {
  return <View style={styles.ruleRow}><Text style={styles.ruleLabel}>{label}</Text><Text style={styles.ruleValue}>{value}</Text></View>;
}

function StatusPill({ status }: { status: MarketingUploadSession['status'] }) {
  const label = status === 'ready' ? 'READY' : status === 'uploading' ? 'UPLOADING' : status === 'partial' ? 'PARTIAL' : 'FAILED';
  return <View style={[styles.statusPill, status === 'ready' ? styles.statusReady : status === 'uploading' ? styles.statusUploading : status === 'partial' ? styles.statusPartial : styles.statusFailed]}><Text style={styles.statusText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F8FB' },
  header: { minHeight: 96, paddingHorizontal: 24, paddingVertical: 18, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 4, maxWidth: 660, lineHeight: 16 },
  headerBadge: { paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.primaryLight, borderRadius: 20, borderWidth: 1, borderColor: '#CFE1FA' },
  headerBadgeText: { color: colors.primaryDark, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  tabs: { minHeight: 52, paddingHorizontal: 18, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'stretch' },
  tab: { minWidth: 130, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary, backgroundColor: '#FAFCFF' },
  tabIcon: { color: colors.muted, fontSize: 14, fontWeight: '900' },
  tabText: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  tabTextActive: { color: colors.primaryDark },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, padding: 18, paddingBottom: 90 },
  libraryLayout: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  libraryLayoutCompact: { flexDirection: 'column' },
  sidebar: { width: 330, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16 },
  sidebarCompact: { width: '100%' },
  sidebarHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  libraryMain: { flex: 1, minWidth: 0, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 18, minHeight: 580 },
  libraryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  fieldLabel: { color: colors.text, fontSize: 9, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  input: { minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 11, color: colors.text, backgroundColor: '#FFFFFF', fontSize: 11 },
  campaignChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 7, backgroundColor: '#F4F6F8', borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: '#BBD7F7' },
  chipText: { color: colors.muted, fontSize: 8, fontWeight: '800' },
  chipTextActive: { color: colors.primaryDark },
  dropZone: { marginTop: 16, minHeight: 188, borderWidth: 1, borderStyle: 'dashed', borderColor: '#9DB9DB', backgroundColor: '#F7FBFF', borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 18 },
  dropZoneBusy: { opacity: 0.78 },
  dropIcon: { color: colors.primary, fontSize: 25, fontWeight: '900' },
  dropTitle: { color: colors.text, fontSize: 12, fontWeight: '900', marginTop: 7 },
  dropHelp: { color: colors.muted, fontSize: 9, marginTop: 4, textAlign: 'center' },
  uploadActions: { marginTop: 13, flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  secondaryButton: { backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 13, paddingVertical: 9, borderWidth: 1, borderColor: '#B8C5D4' },
  secondaryButtonText: { color: colors.primaryDark, fontSize: 9, fontWeight: '900' },
  progressTrack: { width: '100%', height: 7, borderRadius: 8, backgroundColor: '#DFE9F4', overflow: 'hidden', marginTop: 15 },
  progressFill: { height: 7, backgroundColor: colors.primary, borderRadius: 8 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 18 },
  refreshText: { color: colors.primary, fontSize: 8, fontWeight: '900' },
  muted: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  errorText: { color: colors.danger, fontSize: 9, lineHeight: 14, marginTop: 8 },
  sessionCard: { marginTop: 9, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: '#FFFFFF' },
  sessionCardActive: { borderColor: '#97BCE8', backgroundColor: '#F6FAFF' },
  sessionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sessionName: { flex: 1, color: colors.text, fontSize: 10, fontWeight: '900' },
  sessionMeta: { color: colors.muted, fontSize: 8, marginTop: 4 },
  sessionDate: { color: '#98A2B3', fontSize: 7, marginTop: 3 },
  statusPill: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3 },
  statusReady: { backgroundColor: colors.successLight },
  statusUploading: { backgroundColor: colors.infoLight },
  statusPartial: { backgroundColor: colors.warningLight },
  statusFailed: { backgroundColor: colors.dangerLight },
  statusText: { color: colors.text, fontSize: 6, fontWeight: '900' },
  analyzeButton: { backgroundColor: colors.navy, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },
  analyzeButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  buttonDisabled: { opacity: 0.4 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  assetCard: { width: 190, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8, backgroundColor: '#FFFFFF' },
  assetPreview: { width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#EEF2F6' },
  assetImage: { width: '100%', height: '100%' },
  assetStatus: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(11,18,32,0.82)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 4 },
  assetStatusText: { color: '#FFFFFF', fontSize: 6, fontWeight: '900', letterSpacing: 0.4 },
  assetName: { color: colors.text, fontSize: 9, fontWeight: '800', marginTop: 7 },
  assetMeta: { color: colors.muted, fontSize: 7, marginTop: 3 },
  emptyState: { minHeight: 300, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyIcon: { color: '#A9B4C2', fontSize: 34, fontWeight: '900' },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 10 },
  emptyHelp: { color: colors.muted, fontSize: 9, textAlign: 'center', marginTop: 5, maxWidth: 360, lineHeight: 14 },
  foundationWrap: { gap: 14 },
  heroCard: { minHeight: 180, backgroundColor: colors.navy, borderRadius: 16, padding: 24, justifyContent: 'center' },
  heroKicker: { color: '#86B9FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', maxWidth: 620, marginTop: 7 },
  heroText: { color: '#CBD5E1', fontSize: 10, lineHeight: 16, maxWidth: 700, marginTop: 9 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { minWidth: 170, flexGrow: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16 },
  metricValue: { color: colors.text, fontSize: 24, fontWeight: '900' },
  metricLabel: { color: colors.muted, fontSize: 9, marginTop: 3, fontWeight: '700' },
  pipelineCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 18 },
  pipelineRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#EEF1F4' },
  pipelineDot: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pipelineDotDone: { backgroundColor: colors.successLight },
  pipelineDotPending: { backgroundColor: '#F0F2F5' },
  pipelineDotText: { color: colors.text, fontWeight: '900' },
  pipelineLabel: { flex: 1, color: colors.text, fontSize: 10, fontWeight: '800' },
  pipelineState: { fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  pipelineStateDone: { color: colors.success },
  pipelineStatePending: { color: colors.muted },
  foundationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  foundationCard: { width: 260, minHeight: 130, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16 },
  foundationCardTag: { color: colors.primary, fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  foundationCardTitle: { color: colors.text, fontSize: 14, fontWeight: '900', marginTop: 7 },
  foundationCardText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 7 },
  brandRules: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 4, marginTop: 2 },
  ruleRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderBottomColor: '#EEF1F4', paddingHorizontal: 14, paddingVertical: 10 },
  ruleLabel: { width: 150, color: colors.muted, fontSize: 9, fontWeight: '800' },
  ruleValue: { flex: 1, color: colors.text, fontSize: 10, fontWeight: '800' },
});
