const { read, write } = require('./serviceFlowPatchUtils.cjs');

const marker = 'AI_PROFESSIONAL_REPORTS_V8';

function update(file, transform) {
  const source = read(file);
  if (source.includes(marker)) return;
  const result = transform(source);
  if (!result.includes(marker)) throw new Error(`${file} did not receive ${marker}.`);
  write(file, result);
}

function replace(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`Required V8 block not found: ${label}`);
  return source.replace(oldText, newText);
}

update('src/features/technicianPortal/contracts.ts', (original) => {
  let source = replace(
    original,
    `  | 'completed'
  | 'cancelled';

export type ReportSectionType =`,
    `  | 'completed'
  | 'cancelled';

// ${marker}: editable customer-facing narrative generated from verified field data.
export type ProfessionalReportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProfessionalCustomerReport {
  executiveSummary: string;
  workPerformed: string;
  technicalFindings: string;
  measurementsAssessment: string;
  recommendations: string[];
  safetyObservations: string;
  customerConclusion: string;
}

export type ReportSectionType =`,
    'professional report contracts',
  );
  return replace(
    source,
    `  requestedBy?: 'office' | 'client' | 'technician';
  scopeChangeId?: string;
  resultCode?: string;`,
    `  requestedBy?: 'office' | 'client' | 'technician';
  scopeChangeId?: string;
  professionalReportStatus?: ProfessionalReportStatus;
  professionalReport?: ProfessionalCustomerReport;
  professionalReportRequestedAt?: string;
  professionalReportStartedAt?: string;
  professionalReportGeneratedAt?: string;
  professionalReportFailedAt?: string;
  professionalReportEditedAt?: string;
  professionalReportEditedByName?: string;
  professionalReportSourceKey?: string;
  professionalReportModel?: string;
  professionalReportError?: string;
  resultCode?: string;`,
    'professional report intervention fields',
  );
});

update('src/screens/TechnicianInterventionReportScreen.tsx', (original) => replace(
  original,
  `      ...intervention,
      status: 'ready_for_review' as const,
      updatedAt: now,`,
  `      ...intervention,
      status: 'ready_for_review' as const,
      // ${marker}: generation continues in Firebase after the technician leaves this screen.
      professionalReportStatus: 'pending' as const,
      professionalReportRequestedAt: now,
      professionalReportError: undefined,
      updatedAt: now,`,
  'technician background report request',
));

update('src/screens/OfficeReportReviewScreen.tsx', (original) => {
  let source = replace(
    original,
    `import { InterventionStatus, InterventionType, ReportSection, WorkIntervention } from '../features/technicianPortal/contracts';`,
    `import { InterventionStatus, InterventionType, ProfessionalCustomerReport, ReportSection, WorkIntervention } from '../features/technicianPortal/contracts';`,
    'professional report import',
  );
  source = replace(
    source,
    `type ReviewFilter = 'pending' | 'changes_requested' | 'approved';
type CustomerReportOverrides = { reportDate?: string; observation?: string };

const WORK_LABELS`,
    `type ReviewFilter = 'pending' | 'changes_requested' | 'approved';
type CustomerReportOverrides = { reportDate?: string; observation?: string };

// ${marker}: the office owns the final customer wording while technical evidence remains immutable.
type ProfessionalReportEditor = Omit<ProfessionalCustomerReport, 'recommendations'> & { recommendations: string };

const EMPTY_PROFESSIONAL_REPORT: ProfessionalReportEditor = {
  executiveSummary: '',
  workPerformed: '',
  technicalFindings: '',
  measurementsAssessment: '',
  recommendations: '',
  safetyObservations: '',
  customerConclusion: '',
};

function professionalReportToEditor(report?: ProfessionalCustomerReport): ProfessionalReportEditor {
  if (!report) return { ...EMPTY_PROFESSIONAL_REPORT };
  return { ...report, recommendations: (report.recommendations ?? []).join('\\n') };
}

function editorToProfessionalReport(report: ProfessionalReportEditor): ProfessionalCustomerReport | undefined {
  const normalized: ProfessionalCustomerReport = {
    executiveSummary: report.executiveSummary.trim(),
    workPerformed: report.workPerformed.trim(),
    technicalFindings: report.technicalFindings.trim(),
    measurementsAssessment: report.measurementsAssessment.trim(),
    recommendations: report.recommendations.split('\\n').map((item) => item.replace(/^[-•]\\s*/, '').trim()).filter(Boolean),
    safetyObservations: report.safetyObservations.trim(),
    customerConclusion: report.customerConclusion.trim(),
  };
  return normalized.executiveSummary && normalized.workPerformed && normalized.customerConclusion ? normalized : undefined;
}

const WORK_LABELS`,
    'professional report editor helpers',
  );
  source = replace(
    source,
    `  const [lightboxEvidence, setLightboxEvidence] = useState<WorkOrderEvidence | null>(null);
  const [message, setMessage] = useState('Selecciona un reporte pendiente para revisar sus secciones, mediciones y fotografías.');`,
    `  const [lightboxEvidence, setLightboxEvidence] = useState<WorkOrderEvidence | null>(null);
  const [message, setMessage] = useState('Selecciona un reporte pendiente para revisar sus secciones, mediciones y fotografías.');
  const [professionalDraft, setProfessionalDraft] = useState<ProfessionalReportEditor>({ ...EMPTY_PROFESSIONAL_REPORT });`,
    'professional report state',
  );
  source = replace(
    source,
    `  const selectedAddOns = workVisitAddOns.filter((item) => item.interventionId === selected?.id && item.status !== 'cancelled');

  const reportEvidenceIds`,
    `  const selectedAddOns = workVisitAddOns.filter((item) => item.interventionId === selected?.id && item.status !== 'cancelled');

  useEffect(() => {
    setProfessionalDraft(professionalReportToEditor(selected?.professionalReport));
  }, [selected?.id, selected?.professionalReportGeneratedAt, selected?.professionalReportEditedAt]);

  const reportEvidenceIds`,
    'professional report synchronization',
  );
  source = replace(
    source,
    `  function closeReport() {
    setSelectedInterventionId('');
    setCorrectionNote('');
    setMessage('Selecciona otro reporte para revisar.');
  }

  function buildPrintableReport`,
    `  function closeReport() {
    setSelectedInterventionId('');
    setCorrectionNote('');
    setMessage('Selecciona otro reporte para revisar.');
  }

  function setProfessionalField<K extends keyof ProfessionalReportEditor>(field: K, value: ProfessionalReportEditor[K]) {
    setProfessionalDraft((previous) => ({ ...previous, [field]: value }));
  }

  async function requestProfessionalReport() {
    if (!selected || !currentUser || selected.status !== 'ready_for_review') return;
    setWorking(true);
    const now = new Date().toISOString();
    const result = await saveWorkIntervention({
      ...selected,
      professionalReportStatus: 'pending',
      professionalReportRequestedAt: now,
      professionalReportError: undefined,
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selected.updatedByStaffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(selected.version ?? 1)) + 1,
    });
    setWorking(false);
    setMessage(result.ok
      ? 'La IA está preparando el borrador profesional en segundo plano. Puedes salir de esta pantalla y regresar después.'
      : result.message ?? 'No se pudo solicitar el borrador profesional.');
  }

  async function saveProfessionalDraft() {
    if (!selected || !currentUser || selected.status !== 'ready_for_review') return false;
    const professionalReport = editorToProfessionalReport(professionalDraft);
    if (!professionalReport) {
      setMessage('Completa como mínimo el resumen ejecutivo, el trabajo realizado y la conclusión para el cliente.');
      return false;
    }
    setWorking(true);
    const now = new Date().toISOString();
    const result = await saveWorkIntervention({
      ...selected,
      professionalReport,
      professionalReportStatus: 'completed',
      professionalReportEditedAt: now,
      professionalReportEditedByName: currentUser.name,
      professionalReportError: undefined,
      updatedAt: now,
      updatedByUserId: currentUser.id,
      updatedByStaffId: (currentUser as { staffId?: string }).staffId ?? selected.updatedByStaffId,
      updatedByName: currentUser.name,
      version: Math.max(1, Number(selected.version ?? 1)) + 1,
    });
    setWorking(false);
    setMessage(result.ok ? 'Borrador profesional guardado. Ya puedes finalizar el reporte.' : result.message ?? 'No se pudo guardar el borrador profesional.');
    return result.ok;
  }

  function professionalReportForOutput() {
    return editorToProfessionalReport(professionalDraft) ?? selected?.professionalReport;
  }

  function buildPrintableReport`,
    'professional report actions',
  );
  source = replace(
    source,
    `    const mainComponent = selectedEquipment?.components.find((item) => item.componentType === 'indoor') ?? selectedEquipment?.components[0];
    return {`,
    `    const mainComponent = selectedEquipment?.components.find((item) => item.componentType === 'indoor') ?? selectedEquipment?.components[0];
    const professionalReport = professionalReportForOutput();
    return {`,
    'professional report printable selection',
  );
  source = replace(
    source,
    `      observation: overrides.observation ?? selected.customerReportNote,
      sections: [
        ...selectedSections.map`,
    `      observation: overrides.observation ?? selected.customerReportNote,
      sections: [
        ...(professionalReport ? [{
          title: 'Resumen profesional del servicio',
          status: 'Preparado para el cliente',
          fields: [
            { label: 'Resumen ejecutivo', value: professionalReport.executiveSummary },
            { label: 'Trabajo realizado', value: professionalReport.workPerformed },
            { label: 'Hallazgos técnicos', value: professionalReport.technicalFindings },
            { label: 'Evaluación de mediciones', value: professionalReport.measurementsAssessment },
            { label: 'Recomendaciones', value: professionalReport.recommendations.length ? professionalReport.recommendations.map((item) => \`• \${item}\`).join('\\n') : 'No se documentaron recomendaciones adicionales.' },
            { label: 'Observaciones de seguridad', value: professionalReport.safetyObservations },
            { label: 'Conclusión para el cliente', value: professionalReport.customerConclusion },
          ],
        }] : []),
        ...selectedSections.map`,
    'professional report printable section',
  );
  source = replace(
    source,
    `  async function approveReport() {
    if (!selected || !selectedUnit || !currentUser) return;
    const reportWindow`,
    `  async function approveReport() {
    if (!selected || !selectedUnit || !currentUser) return;
    const approvedProfessionalReport = professionalReportForOutput();
    if (!approvedProfessionalReport) {
      setMessage('Genera o completa el borrador profesional antes de finalizar el reporte para el cliente.');
      return;
    }
    const reportWindow`,
    'professional report approval guard',
  );
  source = replace(
    source,
    `      customerReportNote: customerObservation || undefined,
      reviewedAt: now,`,
    `      customerReportNote: customerObservation || undefined,
      professionalReport: approvedProfessionalReport,
      professionalReportStatus: 'completed',
      professionalReportEditedAt: now,
      professionalReportEditedByName: currentUser.name,
      reviewedAt: now,`,
    'professional report approval persistence',
  );
  source = replace(
    source,
    `        {selected.status === 'changes_requested' && selected.resultNotes ? <View style={styles.warningBox}><Text style={styles.warningTitle}>Corrección pendiente</Text><Text style={styles.warningText}>{selected.resultNotes}</Text></View> : null}

        <Card>
          <SectionTitle title="Secciones del reporte"`,
    `        {selected.status === 'changes_requested' && selected.resultNotes ? <View style={styles.warningBox}><Text style={styles.warningTitle}>Corrección pendiente</Text><Text style={styles.warningText}>{selected.resultNotes}</Text></View> : null}

        <Card>
          <SectionTitle
            title="Borrador profesional para el cliente"
            subtitle="La IA organiza la transcripción, mediciones, hallazgos y trabajos registrados. La oficina puede revisar y editar cada texto."
            action={<Pill
              label={selected.professionalReportStatus === 'completed' ? 'Listo' : selected.professionalReportStatus === 'failed' ? 'Requiere atención' : selected.professionalReportStatus === 'pending' || selected.professionalReportStatus === 'processing' ? 'Generando' : 'No generado'}
              tone={selected.professionalReportStatus === 'completed' ? 'success' : selected.professionalReportStatus === 'failed' ? 'warning' : selected.professionalReportStatus === 'pending' || selected.professionalReportStatus === 'processing' ? 'info' : 'neutral'}
            />}
          />
          {selected.professionalReportStatus === 'pending' || selected.professionalReportStatus === 'processing' ? (
            <View style={styles.aiProcessingBox}><Text style={styles.aiProcessingTitle}>Generación en proceso</Text><Text style={styles.aiProcessingText}>Puedes salir de esta pantalla. Firebase continuará preparando el borrador y la bandeja se actualizará automáticamente.</Text></View>
          ) : null}
          {selected.professionalReportStatus === 'failed' ? (
            <View style={styles.warningBox}><Text style={styles.warningTitle}>No se pudo completar el borrador</Text><Text style={styles.warningText}>{selected.professionalReportError || 'El reporte técnico permanece intacto. Puedes solicitar la generación nuevamente.'}</Text></View>
          ) : null}
          {selected.professionalReportStatus !== 'pending' && selected.professionalReportStatus !== 'processing' && !editorToProfessionalReport(professionalDraft) && selected.status === 'ready_for_review' ? (
            <Button variant="success" label={working ? 'Solicitando…' : 'Generar borrador profesional con IA'} disabled={working} onPress={() => void requestProfessionalReport()} />
          ) : null}
          {editorToProfessionalReport(professionalDraft) ? (
            <View style={styles.aiDraftFields}>
              <Input label="Resumen ejecutivo" value={professionalDraft.executiveSummary} onChangeText={(value) => setProfessionalField('executiveSummary', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              <Input label="Trabajo realizado" value={professionalDraft.workPerformed} onChangeText={(value) => setProfessionalField('workPerformed', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              <Input label="Hallazgos técnicos" value={professionalDraft.technicalFindings} onChangeText={(value) => setProfessionalField('technicalFindings', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              <Input label="Evaluación de mediciones" value={professionalDraft.measurementsAssessment} onChangeText={(value) => setProfessionalField('measurementsAssessment', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              <Input label="Recomendaciones — una por línea" value={professionalDraft.recommendations} onChangeText={(value) => setProfessionalField('recommendations', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              <Input label="Observaciones de seguridad" value={professionalDraft.safetyObservations} onChangeText={(value) => setProfessionalField('safetyObservations', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              <Input label="Conclusión para el cliente" value={professionalDraft.customerConclusion} onChangeText={(value) => setProfessionalField('customerConclusion', value)} multiline editable={!working && selected.status === 'ready_for_review'} />
              {selected.status === 'ready_for_review' ? <View style={styles.actionRow}><Button variant="secondary" label={working ? 'Procesando…' : 'Regenerar con IA'} disabled={working} onPress={() => void requestProfessionalReport()} /><Button variant="success" label={working ? 'Guardando…' : 'Guardar borrador'} disabled={working} onPress={() => void saveProfessionalDraft()} /></View> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <SectionTitle title="Secciones del reporte"`,
    'professional report review card',
  );
  source = replace(
    source,
    `<Button variant="success" label={working ? 'Preparando reporte…' : 'Finalizar y abrir reporte'} disabled={working} onPress={() => void approveReport()} />`,
    `<Button variant="success" label={working ? 'Preparando reporte…' : 'Finalizar y abrir reporte'} disabled={working || selected.professionalReportStatus === 'pending' || selected.professionalReportStatus === 'processing' || !editorToProfessionalReport(professionalDraft)} onPress={() => void approveReport()} />`,
    'professional report finalize gate',
  );
  return replace(
    source,
    `  internalNotice: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 10 },
  sectionList:`,
    `  internalNotice: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 10 },
  aiProcessingBox: { backgroundColor: '#EEF6FF', borderRadius: 12, padding: 13 },
  aiProcessingTitle: { color: colors.primaryDark, fontWeight: '900' },
  aiProcessingText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 5 },
  aiDraftFields: { gap: 12 },
  sectionList:`,
    'professional report styles',
  );
});

console.log('patchAiProfessionalReportsV8.cjs applied.');
