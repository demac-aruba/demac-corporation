# DEMAC WhatsApp AI Copilot — v0.4.4

Extensión privada Manifest V3 para asistir a Operaciones dentro de WhatsApp Web. El envío permanece supervisado: el Copilot prepara la respuesta y el operador decide si la inserta o la envía.

## Correcciones de v0.4.4

- Inserta saltos de línea reales en el compositor de WhatsApp; ya no convierte el mensaje en una sola línea.
- Mantiene líneas en blanco y negritas compatibles con WhatsApp.
- Guarda memoria estructurada por conversación para no volver a preguntar tipo de trabajo, cantidad, dirección, fecha o restricción horaria ya confirmados.
- La memoria se identifica por el número técnico de WhatsApp cuando está disponible y, como respaldo, por el título del chat.
- Trata expresiones como `después de las 10`, `a partir de las 10`, `antes de las 10` y sus equivalentes en inglés como restricciones obligatorias.
- Vuelve a consultar la agenda completa del ERP cuando cambia la disponibilidad del cliente.
- Descarta cualquier opción que no cumpla la restricción antes de elegir los mejores cupos.
- Mantiene un máximo de dos opciones visibles, priorizando fechas distintas cuando sea posible.

## Actualizar la extensión

1. Reemplaza el contenido de la carpeta cargada en Chrome con todos los archivos de `extensions/demac-whatsapp-ai-copilot` de esta versión. Es importante incluir `conversation-memory.mjs`.
2. Confirma que el archivo antiguo `content-multiline.js` no exista.
3. Abre `chrome://extensions`.
4. Pulsa **Recargar** en DEMAC WhatsApp AI Copilot.
5. Cierra completamente WhatsApp Web y vuelve a abrirlo.
6. Confirma `Panel 0.4.4 · lector 0.4.4`.

## Desplegar el backend

La corrección de las restricciones horarias requiere desplegar la función actualizada:

```bash
firebase deploy --only functions:whatsappCopilotDraft
```

## Funciones principales

- Consulta disponibilidad real del ERP.
- Optimiza rutas por van, sector y regreso progresivo hacia Santa Cruz.
- Respeta capacidad, duración, vans, técnicos, ausencias, cierres y tardes libres.
- Revalida la disponibilidad antes de crear la cita.
- Mantiene el envío supervisado.
- Responde en español, inglés o Papiamento di Aruba.

## Validación técnica

Desde la carpeta de la extensión:

```bash
node --check background.js
node --check conversation-memory.mjs
node --check composer-linebreaks.js
node --check content.js
node --check sidepanel.js
node --check appointment-guard.js
node --check options.js
node --test conversation-memory.test.mjs
```

Desde `functions`:

```bash
npm run test:whatsapp-copilot
```
