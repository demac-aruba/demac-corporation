# DEMAC WhatsApp AI Copilot — v0.2.0

Extensión privada Manifest V3 para asistir a operaciones dentro de WhatsApp Web.

## Mejoras de esta versión

- Clasifica mensajes recibidos y enviados usando clases, `data-id`, metadatos y posición visual.
- Agrupa mensajes consecutivos del cliente como una sola solicitud.
- Genera respuestas locales más precisas cuando Firebase todavía no está configurado.
- Deja preparada la conexión segura con OpenAI mediante `whatsappCopilotDraft` en Firebase.
- Añade **Insertar** y **Enviar ahora**.
- **Enviar ahora** exige una confirmación explícita antes de pulsar el botón de WhatsApp.
- Muestra mensajes que todavía no puedan clasificarse para facilitar diagnóstico.

## Actualizar una instalación existente

1. Conserva la carpeta original instalada.
2. Reemplaza todos sus archivos con los de esta versión.
3. Abre `chrome://extensions`.
4. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
5. Regresa a WhatsApp Web y actualiza la página con `Ctrl + R`.
6. Abre un chat y pulsa **Leer chat**.

No es necesario eliminar ni volver a instalar la extensión si se usa la misma carpeta.

## OpenAI mediante Firebase

La extensión nunca almacena la clave de OpenAI. Para activar respuestas reales se debe desplegar la función `whatsappCopilotDraft` y definir:

- `OPENAI_API_KEY` en Firebase Secret Manager.
- `WHATSAPP_COPILOT_EXTENSION_TOKEN` como token privado y revocable.

Después, el mismo token se guarda en **Ajustes** de la extensión. Sin token, la extensión continúa funcionando con respuestas locales de prueba.

## Alcance actual

- Procesa solamente el chat abierto.
- No recorre automáticamente chats no leídos.
- No agenda todavía dentro del ERP.
- No adjunta invoices, estimates ni archivos.
- No envía automáticamente al recibir un mensaje; el operador debe pulsar **Enviar ahora** y confirmar.
