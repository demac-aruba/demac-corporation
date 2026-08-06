# DEMAC WhatsApp AI Copilot — v0.2.1

Extensión privada Manifest V3 para asistir a operaciones dentro de WhatsApp Web.

## Mejoras de esta versión

- Clasifica mensajes recibidos y enviados usando metadatos del remitente, iconos de estado, `data-id`, disposición y posición visual.
- Usa `data-pre-plain-text` para reconocer al remitente aunque WhatsApp no exponga `.message-in` y `.message-out`.
- Agrupa mensajes consecutivos del cliente como una sola solicitud.
- Genera respuestas locales más precisas cuando Firebase todavía no está configurado.
- Deja preparada la conexión segura con OpenAI mediante `whatsappCopilotDraft` en Firebase.
- Añade **Insertar** y **Enviar ahora**.
- **Enviar ahora** exige una confirmación explícita antes de pulsar el botón de WhatsApp.
- El panel se comunica directamente con WhatsApp Web para leer, insertar y enviar, evitando procesos anteriores del service worker que puedan quedar en caché.
- Busca el botón verde de enviar por atributos y, como respaldo, por su posición a la derecha del compositor.
- Verifica que WhatsApp vacíe el campo antes de afirmar que el mensaje fue enviado.
- Muestra las versiones del panel y del lector para detectar una recarga incompleta.

## Actualizar una instalación existente

1. Conserva la carpeta original instalada.
2. Reemplaza todos sus archivos con los de esta versión.
3. Abre `chrome://extensions`.
4. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
5. Cierra el panel lateral si permanece abierto.
6. Regresa a WhatsApp Web y actualiza la página con `Ctrl + Shift + R`.
7. Vuelve a abrir el panel, abre un chat y pulsa **Leer chat**.
8. Confirma que en la parte inferior aparezca `Panel 0.2.1 · lector 0.2.1`.

No es necesario eliminar ni volver a instalar la extensión si se usa la misma carpeta. Si Chrome continúa mostrando un lector anterior, cierra WhatsApp Web, pulsa **Recargar** otra vez y vuelve a abrir WhatsApp Web.

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
