# DEMAC WhatsApp AI Copilot — v0.4.6

Extensión privada para asistir a Operaciones dentro de WhatsApp Web. El operador conserva la aprobación final del mensaje.

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

## Router unificado del ERP

La extensión utiliza un solo endpoint: `whatsappCopilotDraft`. El backend decide primero si el último mensaje es una pregunta directa o una coordinación de cita.

Una frase como:

```text
Yo puedo después de las 10, pero ¿cuánto tiempo durará el servicio?
```

se responde como pregunta de duración y no vuelve a ofrecer horarios.

## Base de conocimiento por reglas

El ERP incorpora una sección de administración llamada **Reglas del WhatsApp Copilot**. Cada regla puede guardar intención, frases de ejemplo, prioridad, estado, fuente dinámica del ERP y respuestas aprobadas en español, inglés y Papiamento Aruba.

La IA solamente clasifica la pregunta y selecciona una regla válida. La respuesta sale del ERP o de un texto previamente aprobado.

Las reglas se guardan en `whatsappKnowledgeRules`.

## Despliegue

```bash
firebase deploy --only functions:whatsappCopilotDraft,functions:whatsappCopilotKnowledge --project demac-corporation
npm run patch:all
firebase deploy --only firestore:rules --project demac-corporation
```

Después instala la extensión v0.4.6, recárgala en `chrome://extensions`, cierra WhatsApp Web y vuelve a abrirlo. Debe mostrar `Panel 0.4.6 · lector 0.4.6`.
