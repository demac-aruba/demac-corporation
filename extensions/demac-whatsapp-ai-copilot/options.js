const DEFAULT_SETTINGS = {
  backendUrl: "https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft",
  backendToken: "",
  companyName: "DEMAC Professional Cooling Solutions",
  operatorName: "Operaciones",
  maxMessages: 24,
  languageMode: "auto",
};

const form = document.querySelector("#settingsForm");
const saveStatus = document.querySelector("#saveStatus");

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(settings)) {
    const input = document.querySelector(`#${key}`);
    if (input) input.value = value;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const settings = {
    backendUrl: document.querySelector("#backendUrl").value.trim(),
    backendToken: document.querySelector("#backendToken").value.trim(),
    companyName: document.querySelector("#companyName").value.trim(),
    operatorName: document.querySelector("#operatorName").value.trim(),
    maxMessages: Math.max(1, Math.min(50, Number(document.querySelector("#maxMessages").value) || 24)),
    languageMode: document.querySelector("#languageMode").value,
  };
  await chrome.storage.local.set(settings);
  saveStatus.textContent = "Ajustes guardados.";
  setTimeout(() => { saveStatus.textContent = ""; }, 2500);
});

loadSettings();
