# DEMAC WhatsApp AI Copilot — v0.2.2

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
2. Borra todos los archivos que contiene esa carpeta, sin borrar la carpeta misma.
3. Copia dentro de ella todos los archivos de v0.2.2.
4. Cierra el panel lateral y todas las pestañas de WhatsApp Web.
5. Abre `chrome://extensions`.
6. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
7. Abre nuevamente WhatsApp Web y el panel.
8. Pulsa **Leer chat**.

No es necesario eliminar ni volver a instalar la extensión si se conserva la misma carpeta.

## Corrección 0.2.2

- Evita que un panel antiguo almacenado en memoria falle cuando falta un elemento opcional como `buildInfo`.
- Valida la interfaz antes de iniciar y muestra una explicación clara si los archivos están mezclados.
- Reinyecta automáticamente el lector actual en WhatsApp Web cuando Chrome conserva un content script anterior.
- Usa la versión del `manifest.json` como única fuente de versión para el panel y el lector.
- Evita listeners y observadores duplicados al reinyectar el lector.
- Reconoce nodos donde `data-pre-plain-text` se encuentra en el mismo elemento del texto o en uno de sus contenedores.
- Utiliza el primer elemento visible entre metadata, texto y burbuja para calcular correctamente si el mensaje está a la izquierda o derecha.

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
