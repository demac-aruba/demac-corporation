# DEMAC WhatsApp AI Copilot — v0.4.7

Extensión privada para asistir a Operaciones dentro de WhatsApp Web.

## Modo normal

Fuera de pruebas, el flujo continúa supervisado: el operador genera, revisa y decide cuándo enviar.

## Modo automático de prueba

La v0.4.7 añade un control en el panel llamado **Respuesta automática**.

- Se activa manualmente desde el chat de prueba abierto.
- Queda vinculado exclusivamente a esa conversación, usando el identificador técnico de WhatsApp cuando está disponible.
- No responde a otros chats aunque el usuario navegue a ellos.
- Solo reacciona cuando el mensaje más reciente es realmente entrante.
- Espera brevemente para agrupar mensajes consecutivos del cliente antes de generar la respuesta.
- Genera mediante OpenAI + reglas/agenda del ERP y envía automáticamente usando únicamente el botón **Send / Enviar** verificado.
- Si llega otro mensaje mientras la IA está pensando, descarta el borrador anterior y responde al turno más reciente.
- Si el backend exige revisión humana, no envía automáticamente.
- Si el cliente selecciona una cita, revalida el cupo y crea la cita real en el ERP antes de mandar la confirmación.
- El modo se guarda solamente en `chrome.storage.session`: se desactiva al cerrar Chrome y también expira después de 8 horas.
- Se deduplican mensajes para impedir respuestas dobles.

Este modo está destinado exclusivamente a números/controlados de prueba. Para clientes reales debe mantenerse desactivado hasta completar la validación.

## Envío seguro

- La extensión solamente pulsa un control verificado como **Send / Enviar**.
- El micrófono, grabación de voz y controles alternativos quedan excluidos.
- Si WhatsApp no muestra un botón de envío verificable, el mensaje permanece en el campo y la extensión no pulsa ningún otro control.

## Inserción verificada

La extensión prueba varias estrategias compatibles con el editor de WhatsApp y verifica que el texto realmente apareció antes de continuar:

1. pegado de texto plano;
2. inserción HTML con saltos reales;
3. inserción nativa por líneas;
4. actualización controlada del campo editable con eventos de entrada.

Si el borrador contiene saltos y WhatsApp lo convierte en una sola línea, la inserción se considera fallida y no se intenta enviar.

## ERP como fuente de verdad

La extensión utiliza `whatsappCopilotDraft`. El backend decide primero si el último mensaje es una pregunta directa o una coordinación de cita y obtiene precio, duración, reglas y disponibilidad desde el ERP.

## Instalación

Instala la carpeta completa de la extensión v0.4.7, recárgala en `chrome://extensions`, cierra WhatsApp Web y vuelve a abrirlo. Debe mostrar `Panel 0.4.7 · lector 0.4.7`.

Esta versión no requiere un nuevo despliegue de Firebase si el backend de reglas unificadas ya fue desplegado.