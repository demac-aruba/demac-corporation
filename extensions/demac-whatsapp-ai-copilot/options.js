const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 30,
  languageMode: "auto",
};

const EXPECTED_RUNTIME_VERSION = 18;
const form = document.querySelector("#settingsForm");
const saveStatus = document.querySelector("#saveStatus");
const testBackendButton = document.querySelector("#testBackendButton");
const backendStatus = document.querySelector("#backendStatus");
const backendNotice = document.querySelector("#backendNotice");

function readForm() {
  return {
    backendUrl: document.querySelector("#backendUrl").value.trim(),
    backendToken: document.querySelector("#backendToken").value.trim(),
    companyName: document.querySelector("#companyName").value.trim(),
    operatorName: document.querySelector("#operatorName").value.trim(),
    maxMessages: Math.max(8, Math.min(50, Number(document.querySelector("#maxMessages").value) || 30)),
    languageMode: document.querySelector("#languageMode").value,
  };
}

async function saveSettings() {
  const settings = readForm();
  await chrome.storage.local.set(settings);
  saveStatus.textContent = "Ajustes guardados.";
  setTimeout(() => { saveStatus.textContent = ""; }, 2500);
  return settings;
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(settings)) {
    const input = document.querySelector(`#${key}`);
    if (input) input.value = value;
  }
  backendStatus.textContent = settings.backendToken
    ? `Token guardado. Pulsa “Probar OpenAI + ERP” para confirmar que Firebase ejecuta el orquestador V${EXPECTED_RUNTIME_VERSION}.`
    : "El backend todavía no está activado. El modo local puede recopilar datos, pero no ofrece ni confirma horarios.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings();
});

testBackendButton.addEventListener("click", async () => {
  testBackendButton.disabled = true;
  backendNotice.dataset.kind = "working";
  backendStatus.textContent = "Comprobando Firebase, OpenAI, agenda ERP y versión del orquestador conversacional…";
  try {
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: "TEST_BACKEND" });
    if (!response?.ok) throw new Error(response?.error || "No se pudo verificar el backend.");

    const runtimeVersion = Number(response.result?.conversationPolicyVersion || 0);
    const functionName = String(response.result?.functionName || "");
    if (runtimeVersion !== EXPECTED_RUNTIME_VERSION || functionName !== "whatsappCopilotDraft") {
      throw new Error(
        `Backend desactualizado. Se esperaba whatsappCopilotDraft V${EXPECTED_RUNTIME_VERSION}, `
        + `pero Firebase reportó ${functionName || "sin nombre"} V${runtimeVersion || "?"}.`,
      );
    }

    const vocabulary = response.result?.papiamentoVocabulary;
    const vocabularyText = vocabulary?.wordCount
      ? ` Vocabulario de Papiamento: ${Number(vocabulary.wordCount).toLocaleString("es-AW")} palabras.`
      : "";
    backendNotice.dataset.kind = "ready";
    backendStatus.textContent = `Conectado correctamente: ${functionName} · Orquestador V${runtimeVersion} · ${response.result?.model || "OpenAI"}.${vocabularyText}`;
  } catch (error) {
    backendNotice.dataset.kind = "error";
    backendStatus.textContent = error?.message || String(error);
  } finally {
    testBackendButton.disabled = false;
  }
});

loadSettings();