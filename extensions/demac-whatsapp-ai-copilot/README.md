# DEMAC WhatsApp AI Copilot — v0.4.1

Extensión privada Manifest V3 para asistir a Operaciones dentro de WhatsApp Web. El envío permanece supervisado: el Copilot prepara la respuesta y el operador decide si la inserta o la envía.

## Cambios de v0.4.1

- Conserva los saltos de línea reales al insertar o enviar mensajes desde el panel hacia WhatsApp Web.
- Mantiene párrafos separados, líneas en blanco y negritas compatibles con WhatsApp.
- Reduce las opciones de agenda visibles al cliente a un máximo de dos.
- Prioriza dos fechas distintas cuando existen varias alternativas disponibles.
- Evita repetir dirección y cantidad de aires innecesariamente en el mensaje de opciones.
- Estructura también la confirmación final con fecha, hora y dirección en líneas separadas.

## Funciones principales

- Lee la conversación completa visible y conserva cantidad, dirección, idioma y restricciones ya proporcionadas.
- Corrige la separación de mensajes como `2 aires en Wayaca 217`: cantidad `2`, dirección `Wayaca 217`.
- Deja de preguntarle al cliente qué día u hora desea cuando ya están completos el trabajo, la cantidad y la dirección.
- Consulta disponibilidad real en Firestore usando órdenes, duración, cierres, tardes libres, vans, conductor, ayudante y ausencias.
- Evalúa cada van de forma independiente y utiliza la primera cita de la mañana y de la tarde como anclas de ruta.
- Favorece el mismo sector, sectores adyacentes y recorridos que regresen hacia Santa Cruz.
- Respeta días u horarios mencionados voluntariamente por el cliente.
- Revalida el cupo dentro de una transacción antes de crear la cita.
- Crea una orden principal y asignaciones internas de apoyo sin confirmaciones duplicadas.
- Utiliza el vocabulario oficial `Vocabulario di Papiamento — Aruba 2009` como referencia de validación.

## Flujo de programación

1. OpenAI identifica intención, idioma, tipo de trabajo, cantidad, dirección y restricciones voluntarias.
2. El backend consulta el ERP durante los próximos 21 días.
3. Descarta cupos imposibles y puntúa rutas eficientes.
4. Devuelve como máximo dos opciones para el cliente.
5. Cuando el cliente selecciona una opción, el Copilot prepara la confirmación pendiente.
6. Al pulsar **Enviar ahora**, el backend vuelve a consultar la agenda.
7. Si el cupo sigue disponible, crea la cita y luego envía el mensaje.
8. Si cambió, presenta nuevas opciones sin confirmar una cita incorrecta.

## Actualizar la extensión instalada

1. Reemplaza el contenido de la carpeta cargada en Chrome por los archivos de esta versión.
2. Abre `chrome://extensions`.
3. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
4. Cierra y abre nuevamente WhatsApp Web.
5. Confirma que el pie del panel muestre `Panel 0.4.1 · lector 0.4.1`.
6. El endpoint y el token permanecen guardados normalmente; si Chrome los elimina, vuelve a pegarlos en Ajustes.

## Desplegar el backend

```bash
firebase deploy --only functions:whatsappCopilotDraft
```

## Validación técnica

Desde `functions`:

```bash
npm run test:whatsapp-copilot
node --check whatsappCopilot.js
node --check whatsappCopilotSchedulingCore.js
node --check whatsappCopilotAvailability.js
node --check whatsappCopilotScheduling.js
node --check whatsappCopilotPresentation.js
```

Para la extensión:

```bash
node --check background.js
node --check content.js
node --check content-multiline.js
node --check sidepanel.js
node --check appointment-guard.js
node --check options.js
```

## Límites deliberados

- Solamente procesa el chat abierto.
- No recorre chats pendientes automáticamente.
- El operador conserva la aprobación final del mensaje.
- Si no puede identificar de forma segura el número de WhatsApp para una cita nueva, transfiere la conversación a Operaciones.
