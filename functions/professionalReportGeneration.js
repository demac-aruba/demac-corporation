const { getApp, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const papiamentoVocabulary = require("./data/papiamento-aruba-vocabulary-2009.json");

const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app);
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const REPORT_MODEL = "gpt-5.6-terra";
const TRANSCRIPTION_WAIT_ATTEMPTS = 12;
const TRANSCRIPTION_WAIT_MS = 5_000;
const TRANSLATION_LANGUAGES = {
  pap_aw: "Papiamento di Aruba",
  en: "English",
};
const PAPIAMENTO_WORDS = new Set(papiamentoVocabulary.words);
const PAPIAMENTO_TECHNICAL_WORDS = new Set([
  "demac", "airco", "btu", "psi", "hvac", "split", "cassette", "blower", "bracket",
  "armaflex", "disconnect", "indoor", "outdoor", "r22", "r32", "r410a", "vrf",
]);

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executiveSummary",
    "workPerformed",
    "technicalFindings",
    "measurementsAssessment",
    "recommendations",
    "safetyObservations",
    "customerConclusion",
  ],
  properties: {
    executiveSummary: { type: "string" },
    workPerformed: { type: "string" },
    technicalFindings: { type: "string" },
    measurementsAssessment: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } },
    safetyObservations: { type: "string" },
    customerConclusion: { type: "string" },
  },
};

const WORK_TYPE_LABELS = {
  standard_service: "Servicio estándar",
  deep_service: "Servicio profundo",
  repair: "Reparación",
  installation: "Instalación",
  diagnostic: "Diagnóstico",
  checkup: "Chequeo",
};

const SECTION_LABELS = {
  identification: "Identificación",
  indoor: "Unidad interior",
  outdoor: "Unidad exterior",
  electrical: "Sistema eléctrico",
  initial_measurements: "Mediciones iniciales",
  work_process: "Trabajo realizado",
  final_measurements: "Mediciones finales",
  materials: "Materiales",
  findings: "Hallazgos",
  completion: "Resultado final",
};

const FIELD_LABELS = {
  workSummary: "Resumen escrito del técnico",
  workVoiceNote: "Nota de voz del técnico",
  bracketCondition: "Condición del bracket o base",
  bracketRecommendation: "Recomendación sobre el bracket",
  disconnectCondition: "Condición del switch / disconnect",
  disconnectRecommendation: "Recomendación sobre el switch / disconnect",
  armaflexCondition: "Condición del Armaflex",
  armaflexRecommendation: "Recomendación sobre el Armaflex",
  refrigerantStatus: "Diagnóstico final del refrigerante",
  refrigerantAdded: "Se agregó refrigerante",
  psiAdded: "Cantidad de PSI agregados",
  refrigerantRecommendation: "Recomendación sobre el refrigerante",
  voltage: "Voltaje",
  amperage: "Amperaje",
  lowPressure: "Presión baja",
  highPressure: "Presión alta",
  returnTemp: "Temperatura de retorno",
  supplyTemp: "Temperatura de suministro",
  ambientTemp: "Temperatura ambiente",
  findingCategory: "Categoría del hallazgo",
  findingSeverity: "Severidad del hallazgo",
  findingDescription: "Descripción del hallazgo",
  operationalResult: "Resultado operacional",
  coolingTestCompleted: "Prueba de enfriamiento completada",
  drainTestCompleted: "Prueba de drenaje completada",
  electricalTestCompleted: "Prueba eléctrica completada",
  completionNotes: "Observaciones finales",
  reportedProblem: "Problema informado",
  confirmedSymptom: "Síntoma confirmado",
  problemHistory: "Historial del problema",
  testsPerformed: "Pruebas realizadas",
  confirmedCause: "Causa confirmada",
  probableCause: "Causa probable",
  affectedComponent: "Componente afectado",
  repairPerformed: "Reparación realizada",
  requiredParts: "Piezas necesarias",
  recommendedRepair: "Reparación recomendada",
  materialsUsed: "Materiales utilizados",
  indoorCondition: "Condición general indoor",
  outdoorCondition: "Condición general outdoor",
  powerIsolated: "Energía aislada de forma segura",
  connectionsInspected: "Conexiones inspeccionadas",
  circuitOpened: "Circuito de refrigerante abierto",
  vacuumPerformed: "Vacuum realizado",
  leakTestPerformed: "Prueba de fuga realizada",
  breaker: "Breaker",
  wireGauge: "Calibre de cable",
  lineLength: "Metros de tubería",
  additionalRefrigerant: "Refrigerante adicional",
};

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.trim().slice(0, 4_000);
  if (Array.isArray(value)) return value.slice(0, 30).map(cleanScalar);
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value).slice(0, 4_000);
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function comparableValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value.toMillis === "function") return String(value.toMillis());
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return String(value);
}

function generationRequested(before, after) {
  if (after.status !== "ready_for_review") return false;
  const enteredReview = before.status !== "ready_for_review";
  const manualRequest = Boolean(after.professionalReportRequestedAt)
    && comparableValue(after.professionalReportRequestedAt) !== comparableValue(before.professionalReportRequestedAt);
  return enteredReview || manualRequest;
}

function generationKey(after) {
  return after.professionalReportRequestedAt
    ? `request:${comparableValue(after.professionalReportRequestedAt)}`
    : `review:${after.version || comparableValue(after.updatedAt) || "initial"}`;
}

async function loadEvidence(evidenceIds) {
  const uniqueIds = [...new Set(evidenceIds.filter(Boolean))];
  if (!uniqueIds.length) return [];
  const snapshots = await db.getAll(...uniqueIds.map((id) => db.collection("workOrderEvidence").doc(id)));
  return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
}

async function loadEvidenceAfterTranscription(evidenceIds) {
  let evidence = [];
  for (let attempt = 0; attempt <= TRANSCRIPTION_WAIT_ATTEMPTS; attempt += 1) {
    evidence = await loadEvidence(evidenceIds);
    const waitingForAudio = evidence.some((item) => item.mediaKind === "audio"
      && ["pending", "processing"].includes(item.transcriptionStatus));
    if (!waitingForAudio || attempt === TRANSCRIPTION_WAIT_ATTEMPTS) return evidence;
    await wait(TRANSCRIPTION_WAIT_MS);
  }
  return evidence;
}

function reportContext({ intervention, visit, unit, equipment, sections, addOns, evidence }) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const describeValue = (value) => {
    if (typeof value === "string" && evidenceById.has(value)) {
      const item = evidenceById.get(value);
      if (item.mediaKind === "audio") {
        return item.transcript
          ? { type: "nota_de_voz_transcrita", text: item.transcript }
          : { type: "nota_de_voz", status: item.transcriptionStatus || "sin_transcripción" };
      }
      return { type: "fotografía", label: item.label || "Evidencia fotográfica disponible" };
    }
    return cleanScalar(value);
  };

  return {
    language: "es",
    workType: WORK_TYPE_LABELS[intervention.type] || intervention.type,
    scheduledScope: {
      service: cleanScalar(visit?.scheduledScopeSnapshot?.serviceName),
      reportedProblem: cleanScalar(visit?.scheduledScopeSnapshot?.problemDescription),
      officeInstructions: cleanScalar(visit?.scheduledScopeSnapshot?.technicianInstructions),
    },
    equipment: {
      location: cleanScalar(equipment?.locationLabel || unit?.locationLabel),
      systemType: cleanScalar(equipment?.systemType),
      components: (equipment?.components || []).slice(0, 10).map((component) => ({
        componentType: cleanScalar(component.componentType),
        brand: cleanScalar(component.brand),
        model: cleanScalar(component.model),
        btu: cleanScalar(component.btu),
        refrigerant: cleanScalar(component.refrigerant),
        voltage: cleanScalar(component.voltage),
        notes: cleanScalar(component.notes),
      })),
    },
    reportSections: sections.map((section) => ({
      section: SECTION_LABELS[section.sectionType] || section.sectionType,
      status: section.status,
      fields: Object.entries(section.fields || {}).map(([key, value]) => ({
        field: FIELD_LABELS[key] || key,
        value: describeValue(value),
      })),
    })),
    addOns: addOns.map((addOn) => ({
      type: cleanScalar(addOn.type),
      status: cleanScalar(addOn.status),
      notes: cleanScalar(addOn.notes),
    })),
    evidenceSummary: evidence.map((item) => ({
      label: cleanScalar(item.label),
      mediaKind: cleanScalar(item.mediaKind || "image"),
      moment: cleanScalar(item.moment),
      transcript: item.mediaKind === "audio" ? cleanScalar(item.transcript) : undefined,
    })),
  };
}

async function requestProfessionalReport(context) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: REPORT_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 1_500,
      instructions: [
        "Eres el redactor técnico de DEMAC Professional Cooling Solutions.",
        "Convierte exclusivamente la evidencia proporcionada en un reporte profesional para el cliente, en español claro y correcto.",
        "No inventes diagnósticos, mediciones, trabajos, piezas ni recomendaciones. Si un dato no está documentado, indícalo de forma neutral.",
        "No menciones nombres de técnicos, ayudantes, personal de oficina, vans, precios, inventario, procesos internos ni inteligencia artificial.",
        "Mantén marcas, modelos, BTU, PSI, voltajes, refrigerantes y nombres técnicos exactamente como fueron documentados.",
        "Separa con claridad el trabajo realizado, los hallazgos confirmados, las mediciones y las recomendaciones futuras.",
        "Las fotografías son evidencia del reporte; no afirmes detalles visuales que no estén descritos en los datos.",
        "Evita toda repetición y escribe para un cliente que necesita entender el resultado en menos de dos minutos.",
        "Resumen ejecutivo: máximo 45 palabras. Trabajo realizado: máximo 5 viñetas, cada una de máximo 16 palabras.",
        "Hallazgos técnicos: máximo 4 viñetas. Evaluación de mediciones: máximo 45 palabras.",
        "Recomendaciones: máximo 4 acciones, cada una de máximo 18 palabras.",
        "Observaciones de seguridad: una sola oración y déjala vacía cuando no exista un riesgo documentado.",
        "Conclusión para el cliente: 2 o 3 oraciones, máximo 35 palabras.",
        "En los campos de texto con varias acciones utiliza viñetas iniciadas por • y separadas por salto de línea.",
      ].join(" "),
      input: `Datos verificados del servicio:\n${JSON.stringify(context)}`,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "demac_professional_customer_report",
          strict: true,
          schema: REPORT_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}`;
    const error = new Error(message);
    error.code = payload?.error?.code || response.status;
    throw error;
  }
  const text = outputText(payload);
  if (!text) throw new Error("OpenAI no devolvió el borrador profesional.");
  const report = JSON.parse(text);
  for (const field of REPORT_SCHEMA.required) {
    if (!(field in report)) throw new Error(`El borrador profesional no incluyó ${field}.`);
  }
  return report;
}

function translationRequests(before, after) {
  if (after.status !== "completed" || !after.professionalReport) return [];
  return Object.keys(TRANSLATION_LANGUAGES).filter((language) => {
    const previous = before.professionalReportTranslationRequestedAt?.[language];
    const current = after.professionalReportTranslationRequestedAt?.[language];
    return Boolean(current) && comparableValue(current) !== comparableValue(previous);
  });
}

function translationGenerationKey(intervention, language) {
  const requestedAt = intervention.professionalReportTranslationRequestedAt?.[language];
  const spanishVersion = intervention.professionalReportEditedAt
    || intervention.professionalReportGeneratedAt
    || intervention.reviewedAt
    || intervention.updatedAt;
  return `${language}:${comparableValue(requestedAt)}:${comparableValue(spanishVersion)}`;
}

async function loadApprovedPapiamentoCorrections() {
  const snapshot = await db.collection("papiamentoCorrections")
    .where("active", "==", true)
    .limit(100)
    .get();
  return snapshot.docs.map((document) => {
    const correction = document.data();
    return {
      section: cleanScalar(correction.sectionKey),
      spanishSource: cleanScalar(correction.sourceText),
      previousTranslation: cleanScalar(correction.generatedText),
      approvedCorrection: cleanScalar(correction.correctedText),
    };
  });
}

function professionalReportText(report) {
  return [
    report.executiveSummary,
    report.workPerformed,
    report.technicalFindings,
    report.measurementsAssessment,
    ...(report.recommendations || []),
    report.safetyObservations,
    report.customerConclusion,
  ].filter(Boolean).join("\n");
}

function papiamentoUnknownWords(report) {
  const unknown = new Set();
  const tokens = professionalReportText(report).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  for (const originalToken of tokens) {
    if (/\d/.test(originalToken) || /^[A-Z]{2,}$/.test(originalToken)) continue;
    const token = originalToken.toLocaleLowerCase("pap-AW").normalize("NFC");
    if (token.length <= 1 || PAPIAMENTO_WORDS.has(token) || PAPIAMENTO_TECHNICAL_WORDS.has(token)) continue;
    unknown.add(token);
    if (unknown.size >= 60) break;
  }
  return [...unknown].sort((first, second) => first.localeCompare(second, "pap-AW"));
}

async function requestProfessionalTranslation(report, language, corrections) {
  const languageName = TRANSLATION_LANGUAGES[language];
  if (!languageName) throw new Error(`Unsupported report language: ${language}`);
  const papiamentoInstructions = language === "pap_aw" ? [
    "Traduce específicamente a Papiamento di Aruba con la ortografía oficial de Aruba; no uses Papiamentu de Curaçao.",
    "Las correcciones aprobadas por la oficina son ejemplos autoritativos de terminología y estilo DEMAC. Aplícalas cuando el contexto sea equivalente.",
    "Conserva sin traducir marcas, modelos, códigos, BTU, PSI, voltajes, refrigerantes y abreviaturas técnicas.",
  ] : [
    "Translate into clear professional English suitable for an HVAC customer in Aruba.",
    "Preserve brands, models, codes, BTU, PSI, voltages, refrigerants, and technical abbreviations exactly.",
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: REPORT_MODEL,
      reasoning: { effort: "low" },
      max_output_tokens: 1_500,
      instructions: [
        `Eres el traductor técnico de DEMAC. Traduce el reporte aprobado al idioma ${languageName}.`,
        "Traduce fielmente sin agregar, eliminar ni reinterpretar diagnósticos, mediciones, trabajos o recomendaciones.",
        "Mantén exactamente la misma estructura JSON, el tono profesional y la extensión breve del original.",
        "No menciones procesos internos, inteligencia artificial ni instrucciones de traducción.",
        ...papiamentoInstructions,
      ].join(" "),
      input: JSON.stringify({
        approvedSpanishReport: report,
        approvedPapiamentoCorrectionExamples: language === "pap_aw" ? corrections : [],
      }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: `demac_professional_report_${language}`,
          strict: true,
          schema: REPORT_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI returned HTTP ${response.status}`;
    const error = new Error(message);
    error.code = payload?.error?.code || response.status;
    throw error;
  }
  const text = outputText(payload);
  if (!text) throw new Error(`OpenAI no devolvió la traducción ${languageName}.`);
  const translated = JSON.parse(text);
  for (const field of REPORT_SCHEMA.required) {
    if (!(field in translated)) throw new Error(`La traducción no incluyó ${field}.`);
  }
  return translated;
}

exports.generateProfessionalCustomerReport = onDocumentUpdated(
  {
    document: "workInterventions/{interventionId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 240,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (!generationRequested(before, after)) return;

    const interventionRef = event.data.after.ref;
    const runKey = generationKey(after);
    const claimed = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(interventionRef);
      const current = currentSnapshot.data() || {};
      if (current.status !== "ready_for_review") return false;
      if (current.professionalReportStatus === "processing" && current.professionalReportSourceKey === runKey) return false;
      if (current.professionalReportStatus === "completed" && current.professionalReportSourceKey === runKey) return false;
      transaction.set(interventionRef, {
        professionalReportStatus: "processing",
        professionalReportSourceKey: runKey,
        professionalReportError: FieldValue.delete(),
        professionalReportStartedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!claimed) return;

    try {
      const [visitSnapshot, unitSnapshot, equipmentSnapshot, sectionSnapshot, addOnSnapshot] = await Promise.all([
        after.visitId ? db.collection("workVisits").doc(after.visitId).get() : null,
        after.visitUnitId ? db.collection("visitUnits").doc(after.visitUnitId).get() : null,
        after.equipmentSystemId ? db.collection("equipmentSystems").doc(after.equipmentSystemId).get() : null,
        db.collection("workReportSections").where("interventionId", "==", event.params.interventionId).get(),
        db.collection("workVisitAddOns").where("interventionId", "==", event.params.interventionId).get(),
      ]);

      const visit = visitSnapshot?.data() || {};
      const unit = unitSnapshot?.data() || {};
      let equipment = equipmentSnapshot?.data() || {};
      if (!equipmentSnapshot?.exists && unit.equipmentSystemId) {
        equipment = (await db.collection("equipmentSystems").doc(unit.equipmentSystemId).get()).data() || {};
      }
      const sections = sectionSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
      const addOns = addOnSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
        .filter((item) => item.status !== "cancelled");
      const evidenceIds = [
        ...sections.flatMap((section) => section.evidenceIds || []),
        ...addOns.flatMap((addOn) => [addOn.beforeEvidenceId, addOn.afterEvidenceId]),
      ];
      const evidence = await loadEvidenceAfterTranscription(evidenceIds);
      const context = reportContext({ intervention: after, visit, unit, equipment, sections, addOns, evidence });
      const report = await requestProfessionalReport(context);

      await interventionRef.set({
        professionalReport: report,
        professionalReportStatus: "completed",
        professionalReportSourceKey: runKey,
        professionalReportModel: REPORT_MODEL,
        professionalReportError: FieldValue.delete(),
        professionalReportGeneratedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      logger.info("Professional customer report generated.", {
        interventionId: event.params.interventionId,
        model: REPORT_MODEL,
      });
    } catch (error) {
      logger.error("Could not generate professional customer report.", error);
      await interventionRef.set({
        professionalReportStatus: "failed",
        professionalReportSourceKey: runKey,
        professionalReportError: String(error?.message || "Unknown report generation error").slice(0, 1_000),
        professionalReportFailedAt: FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      throw error;
    }
  },
);

exports.generateProfessionalReportTranslation = onDocumentUpdated(
  {
    document: "workInterventions/{interventionId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 240,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const requestedLanguages = translationRequests(before, after);
    if (!requestedLanguages.length) return;

    const interventionRef = event.data.after.ref;
    for (const language of requestedLanguages) {
      const runKey = translationGenerationKey(after, language);
      const claimed = await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(interventionRef);
        const current = currentSnapshot.data() || {};
        if (current.status !== "completed" || !current.professionalReport) return false;
        const currentStatus = current.professionalReportTranslationStatus?.[language];
        const currentKey = current.professionalReportTranslationSourceKey?.[language];
        if (["processing", "completed"].includes(currentStatus) && currentKey === runKey) return false;
        transaction.update(interventionRef, {
          [`professionalReportTranslationStatus.${language}`]: "processing",
          [`professionalReportTranslationSourceKey.${language}`]: runKey,
          [`professionalReportTranslationError.${language}`]: FieldValue.delete(),
          [`professionalReportTranslationStartedAt.${language}`]: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!claimed) continue;

      try {
        const corrections = language === "pap_aw" ? await loadApprovedPapiamentoCorrections() : [];
        const translated = await requestProfessionalTranslation(after.professionalReport, language, corrections);
        const completedAt = new Date().toISOString();
        const updates = {
          [`professionalReportTranslations.${language}`]: translated,
          [`professionalReportTranslationStatus.${language}`]: "completed",
          [`professionalReportTranslationSourceKey.${language}`]: runKey,
          [`professionalReportTranslationModel.${language}`]: REPORT_MODEL,
          [`professionalReportTranslationError.${language}`]: FieldValue.delete(),
          [`professionalReportTranslationGeneratedAt.${language}`]: completedAt,
          updatedAt: completedAt,
        };
        if (language === "pap_aw") {
          updates["professionalReportTranslationUnknownWords.pap_aw"] = papiamentoUnknownWords(translated);
          updates["professionalReportTranslationVocabulary.pap_aw"] = {
            source: papiamentoVocabulary.source,
            sourceUrl: papiamentoVocabulary.sourceUrl,
            orthographyVersion: papiamentoVocabulary.orthographyVersion,
            wordCount: papiamentoVocabulary.wordCount,
          };
        }
        await interventionRef.update(updates);
        logger.info("Professional customer report translation generated.", {
          interventionId: event.params.interventionId,
          language,
          model: REPORT_MODEL,
        });
      } catch (error) {
        logger.error("Could not generate professional customer report translation.", { language, error });
        await interventionRef.update({
          [`professionalReportTranslationStatus.${language}`]: "failed",
          [`professionalReportTranslationSourceKey.${language}`]: runKey,
          [`professionalReportTranslationError.${language}`]: String(error?.message || "Unknown translation error").slice(0, 1_000),
          [`professionalReportTranslationFailedAt.${language}`]: FieldValue.serverTimestamp(),
          updatedAt: new Date().toISOString(),
        });
        throw error;
      }
    }
  },
);

exports.__professionalReportTest = {
  comparableValue,
  generationRequested,
  papiamentoUnknownWords,
  outputText,
  reportContext,
  translationGenerationKey,
  translationRequests,
};
