// Compatibility adapter for the current GPT Image 2 edits API.
// GPT Image 2 rejects the legacy input_fidelity form parameter used by older
// GPT Image models. Keep Creative Builder V2 strict on gpt-image-2 while
// removing only that unsupported parameter from its multipart request.
const NativeFormData = globalThis.FormData;

if (NativeFormData && !globalThis.__demacGptImage2FormDataCompat) {
  class DemacImageFormData extends NativeFormData {
    append(name, value, filename) {
      if (name === 'model') {
        this.__demacImageModel = String(value || '');
      }
      if (name === 'input_fidelity' && this.__demacImageModel === 'gpt-image-2') {
        return undefined;
      }
      if (filename === undefined) return super.append(name, value);
      return super.append(name, value, filename);
    }
  }
  globalThis.FormData = DemacImageFormData;
  globalThis.__demacGptImage2FormDataCompat = true;
}

module.exports = require('./marketingCreativeBuilderV2');
