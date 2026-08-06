# DEMAC WhatsApp AI Copilot — v0.4.2

Extensión privada Manifest V3 para asistir a Operaciones dentro de WhatsApp Web. El envío permanece supervisado: el Copilot prepara la respuesta y el operador decide si la inserta o la envía.

## Corrección de v0.4.2

- Restaura el mecanismo original de inserción y envío que ya funcionaba en WhatsApp Web.
- Elimina la capa v0.4.1 que podía dejar el compositor vacío y confundir el botón del micrófono con el botón de enviar.
- Conserva los saltos de línea insertando el texto línea por línea mediante el mecanismo original de WhatsApp.
- Mantiene líneas en blanco y negritas compatibles con WhatsApp.
- Conserva el máximo de dos opciones de agenda y prioriza dos fechas distintas.

## Actualizar desde v0.4.1

1. Copia `manifest.json` y `composer-linebreaks.js` dentro de la carpeta actual de la extensión.
2. Reemplaza `manifest.json`.
3. Elimina `content-multiline.js` de la carpeta anterior para evitar confusión; la v0.4.2 ya no lo carga.
4. Abre `chrome://extensions`.
5. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
6. Cierra completamente WhatsApp Web y vuelve a abrirlo.
7. Confirma que el pie del panel muestre `Panel 0.4.2 · lector 0.4.2`.

## Funciones principales

- Consulta disponibilidad real del ERP.
- Ofrece como máximo dos opciones al cliente.
- Prioriza dos fechas distintas cuando existen alternativas.
- Optimiza rutas por van y sector.
- Revalida la disponibilidad antes de crear la cita.
- Mantiene el envío supervisado.
- Responde en español, inglés o Papiamento di Aruba.

## Validación técnica

```bash
node --check background.js
node --check composer-linebreaks.js
node --check content.js
node --check sidepanel.js
node --check appointment-guard.js
node --check options.js
```
