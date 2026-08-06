# DEMAC WhatsApp AI Copilot — v0.3.0

Extensión privada Manifest V3 para asistir a operaciones dentro de WhatsApp Web.

## Mejoras de esta versión

- Mantiene la lectura, inserción y envío supervisado que ya funcionan en WhatsApp Web.
- Integra un modo conversacional real mediante OpenAI y Firebase.
- Analiza toda la conversación reciente, no solamente el último mensaje aislado.
- Reconoce datos que el cliente ya proporcionó y evita repetir preguntas.
- Detecta español, inglés y Papiamento di Aruba.
- Devuelve la etapa de la conversación, el próximo paso, datos reconocidos e información pendiente.
- Añade un panel de diagnóstico visible para confirmar idioma, etapa, confianza y datos recopilados.
- Añade **Probar OpenAI** en Ajustes para verificar endpoint, token y clave de OpenAI.
- Mejora el modo local de respaldo para seguir una conversación después de recibir cantidad y dirección.

## Activar OpenAI

La extensión nunca almacena la clave de OpenAI. Para activar el backend:

```bash
firebase functions:secrets:set WHATSAPP_COPILOT_EXTENSION_TOKEN
firebase deploy --only functions:whatsappCopilotDraft
```

El valor configurado en `WHATSAPP_COPILOT_EXTENSION_TOKEN` debe pegarse después en **Ajustes → Token privado de la extensión**. El endpoint predeterminado es:

```text
https://us-central1-demac-corporation.cloudfunctions.net/whatsappCopilotDraft
```

Después pulsa **Probar OpenAI**. La página debe confirmar el modelo activo.

## Actualizar una instalación existente

1. Conserva la carpeta original que Chrome tiene cargada.
2. Borra primero todos los archivos dentro de esa carpeta.
3. Copia dentro todos los archivos de esta versión.
4. Cierra el panel lateral y todas las pestañas de WhatsApp Web.
5. Abre `chrome://extensions`.
6. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
7. Abre WhatsApp Web nuevamente.
8. Abre el panel y confirma que muestre `Panel 0.3.0 · lector 0.3.0`.

## Alcance actual

- Procesa solamente el chat abierto.
- OpenAI prepara la respuesta, pero el operador decide si la envía.
- No recorre automáticamente chats no leídos.
- Todavía no consulta ni crea citas en la agenda del ERP.
- El backend ya devuelve `query_erp_availability` cuando la solicitud está lista para consultar agenda; esa herramienta será la próxima integración.
