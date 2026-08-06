# DEMAC WhatsApp AI Copilot — v0.4.3

Extensión privada Manifest V3 para asistir a Operaciones dentro de WhatsApp Web. El envío permanece supervisado: el Copilot prepara la respuesta y el operador decide si la inserta o la envía.

## Corrección de v0.4.3

- Mantiene el mecanismo original de inserción y envío que ya funciona en WhatsApp Web.
- Corrige el problema de v0.4.2 donde los saltos se insertaban como espacios.
- Convierte únicamente los saltos normales del borrador en separadores visuales Unicode antes de llamar al mismo `insertText` original.
- No divide la inserción en múltiples operaciones.
- No modifica la búsqueda ni el clic del botón de enviar.
- Mantiene líneas en blanco, negritas de WhatsApp y el máximo de dos opciones de agenda.

## Actualizar desde v0.4.2

1. Copia `manifest.json` y `composer-linebreaks.js` dentro de la carpeta actual de la extensión.
2. Reemplaza ambos archivos.
3. Confirma que `content-multiline.js` no exista en la carpeta.
4. Abre `chrome://extensions`.
5. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
6. Cierra completamente WhatsApp Web y vuelve a abrirlo.
7. Confirma `Panel 0.4.3 · lector 0.4.3`.

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
