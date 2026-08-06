# DEMAC WhatsApp AI Copilot — v0.4.0

Extensión privada Manifest V3 para asistir a Operaciones dentro de WhatsApp Web. El envío permanece supervisado: el Copilot prepara la respuesta y el operador decide si la inserta o la envía.

## Qué incorpora v0.4.0

- Lee la conversación completa visible y conserva cantidad, dirección, idioma y restricciones ya proporcionadas.
- Corrige la separación de mensajes como `2 aires en Wayaca 217`: cantidad `2`, dirección `Wayaca 217`.
- Deja de preguntarle al cliente qué día u hora desea cuando ya están completos el trabajo, la cantidad y la dirección.
- Consulta disponibilidad real en Firestore usando:
  - órdenes de trabajo;
  - duración exacta del trabajo;
  - cierres del negocio;
  - tardes libres;
  - vans activas;
  - conductor y ayudante asignados;
  - ausencias y disponibilidad del personal.
- Evalúa cada van de forma independiente y utiliza la primera cita de la mañana y la primera de la tarde como anclas de ruta.
- Favorece trabajos en el mismo sector, sectores adyacentes y recorridos que regresen progresivamente hacia la oficina de Santa Cruz.
- Ofrece solamente las mejores una, dos o tres opciones; nunca expone todos los espacios abiertos.
- Respeta voluntariamente días u horarios mencionados por el cliente sin preguntarlos como requisito.
- Revisa nuevamente el cupo dentro de una transacción antes de crear la cita, evitando doble reserva.
- Crea una orden principal y, cuando la cantidad requiere varias vans, asignaciones de apoyo sin confirmaciones o recordatorios duplicados.
- Utiliza el vocabulario oficial **Vocabulario di Papiamento — Aruba 2009**, con referencia de `papiamento.aw`, para validar las respuestas en Papiamento di Aruba.
- Mantiene marcas, modelos, direcciones y términos HVAC como excepciones revisables.
- Muestra en el panel las opciones ERP, el sector, el número de vans y el ID de la cita creada.
- Bloquea el envío de una supuesta disponibilidad cuando la extensión está únicamente en modo local.

## Flujo de programación

1. OpenAI identifica intención, idioma, tipo de trabajo, cantidad, dirección y cualquier restricción voluntaria.
2. El backend consulta el ERP durante los próximos 21 días.
3. Primero descarta cupos imposibles y luego puntúa las rutas eficientes.
4. Devuelve como máximo tres opciones.
5. Cuando el cliente selecciona una opción, el backend vuelve a consultar la agenda.
6. Si el cupo sigue disponible, crea la cita y las vans de apoyo necesarias.
7. Si el espacio cambió mientras el cliente respondía, no crea una cita duplicada y ofrece nuevas opciones.

## Datos y configuración utilizados

La integración lee las colecciones existentes:

- `workOrders`
- `services`
- `clients`
- `properties`
- `vans`
- `staffProfiles`
- `dailyVanAssignments`
- `staffAbsences`
- `calendarClosures`
- `businessSettings`
- `vanHalfDaySchedules`

Guarda auditoría y ofertas temporales en:

- `whatsappCopilotAudit`
- `whatsappCopilotOffers`

Las Cloud Functions utilizan Firebase Admin, por lo que no se requieren reglas nuevas para estas dos colecciones internas.

### Mapa de sectores

La versión incluye una ruta predeterminada de Aruba, desde Malmok/Arashi y Noord hasta San Nicolás/Seroe Colorado, con Santa Cruz como oficina. Opcionalmente puede sobrescribirse mediante el documento:

```text
businessSettings/whatsapp-copilot-routing
```

Campos admitidos:

```json
{
  "id": "whatsapp-copilot-routing",
  "officeZoneId": "santa-cruz",
  "maximumAnchorDistance": 40,
  "zones": [
    {
      "id": "noord",
      "label": "Noord / Palm Beach",
      "position": 90,
      "aliases": ["noord", "palm beach", "kamay"]
    }
  ]
}
```

No es obligatorio crear este documento para comenzar; el backend utiliza la configuración predeterminada.

## Desplegar el backend

La clave de OpenAI permanece exclusivamente en Firebase Secret Manager. Configura una sola vez el token privado de la extensión:

```bash
firebase functions:secrets:set WHATSAPP_COPILOT_EXTENSION_TOKEN
```

Después despliega la función actualizada:

```bash
firebase deploy --only functions:whatsappCopilotDraft
```

Los módulos `whatsappCopilotSchedulingCore.js`, `whatsappCopilotAvailability.js` y `whatsappCopilotScheduling.js` se incluyen automáticamente con la función.

El valor guardado en `WHATSAPP_COPILOT_EXTENSION_TOKEN` debe pegarse en:

```text
Ajustes → Token privado de la extensión
```

Luego pulsa **Probar OpenAI + ERP**. La prueba debe confirmar OpenAI, agenda ERP y vocabulario de Papiamento.

## Actualizar la extensión instalada

1. Conserva la carpeta que Chrome tiene cargada como extensión sin empaquetar.
2. Reemplaza su contenido con los archivos de `extensions/demac-whatsapp-ai-copilot` de esta versión.
3. Cierra el panel lateral y las pestañas de WhatsApp Web.
4. Abre `chrome://extensions`.
5. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
6. Abre WhatsApp Web nuevamente.
7. Confirma que el pie del panel muestre `Panel 0.4.0 · lector 0.4.0`.
8. Abre Ajustes y pulsa **Probar OpenAI + ERP**.

## Validación técnica

Desde la carpeta `functions`:

```bash
npm run test:whatsapp-copilot
node --check whatsappCopilot.js
node --check whatsappCopilotSchedulingCore.js
node --check whatsappCopilotAvailability.js
node --check whatsappCopilotScheduling.js
```

Para la extensión:

```bash
node --check background.js
node --check content.js
node --check sidepanel.js
node --check options.js
```

## Límites deliberados

- Solamente procesa el chat abierto.
- No recorre chats pendientes automáticamente.
- El operador conserva la aprobación final del mensaje.
- Si no puede identificar de forma segura el número de WhatsApp para una cita nueva, transfiere la conversación a Operaciones en vez de crear datos dudosos.
- La dirección y los sectores nuevos pueden ser corregidos después en el perfil de la propiedad para mejorar futuras rutas.
