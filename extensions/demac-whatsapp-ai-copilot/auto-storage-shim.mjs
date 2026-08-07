const chromeApi = globalThis.chrome;
const localArea = chromeApi?.storage?.local;
const nativeSessionArea = chromeApi?.storage?.session;

function wrapMethod(nativeArea, name) {
  const nativeMethod = typeof nativeArea?.[name] === "function"
    ? nativeArea[name].bind(nativeArea)
    : null;
  const localMethod = typeof localArea?.[name] === "function"
    ? localArea[name].bind(localArea)
    : null;

  return async (...args) => {
    if (nativeMethod) {
      try {
        return await nativeMethod(...args);
      } catch (error) {
        console.warn(`DEMAC Copilot: chrome.storage.session.${name} failed; using local fallback.`, error);
      }
    }
    if (!localMethod) {
      throw new Error(`El almacenamiento temporal de Chrome no está disponible (${name}).`);
    }
    return localMethod(...args);
  };
}

function replacementArea() {
  return {
    get: wrapMethod(nativeSessionArea, "get"),
    set: wrapMethod(nativeSessionArea, "set"),
    remove: wrapMethod(nativeSessionArea, "remove"),
    clear: wrapMethod(nativeSessionArea, "clear"),
    getBytesInUse: wrapMethod(nativeSessionArea, "getBytesInUse"),
  };
}

function installStorageCompatibility() {
  if (!chromeApi?.storage || !localArea) return;
  const replacement = replacementArea();

  if (!nativeSessionArea) {
    try {
      Object.defineProperty(chromeApi.storage, "session", {
        configurable: true,
        enumerable: true,
        value: replacement,
      });
      return;
    } catch (_error) {
      try {
        chromeApi.storage.session = replacement;
        return;
      } catch (error) {
        console.warn("DEMAC Copilot could not install the session storage fallback.", error);
        return;
      }
    }
  }

  for (const [name, method] of Object.entries(replacement)) {
    try {
      Object.defineProperty(nativeSessionArea, name, {
        configurable: true,
        value: method,
      });
    } catch (_error) {
      try {
        nativeSessionArea[name] = method;
      } catch (error) {
        console.warn(`DEMAC Copilot could not wrap chrome.storage.session.${name}.`, error);
      }
    }
  }
}

installStorageCompatibility();
