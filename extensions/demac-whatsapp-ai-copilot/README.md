# DEMAC WhatsApp AI Copilot — v0.1.0

Extensión privada Manifest V3 para probar el flujo de asistencia de WhatsApp dentro de DEMAC.

## Qué incluye

- Panel lateral persistente en Chrome.
- Lectura del chat actualmente abierto en WhatsApp Web.
- Vista de los últimos mensajes visibles.
- Generador local de borradores para pruebas.
- Contrato preparado para conectar un endpoint seguro de Firebase/OpenAI.
- Edición del borrador antes de insertarlo.
- Inserción del texto en el campo de WhatsApp sin pulsar Enviar.
- Ajustes de idioma, cantidad de contexto y endpoint.

## Qué no incluye todavía

- Envío automático.
- Escaneo de todas las conversaciones.
- Agendamiento en el ERP.
- Identificación del cliente en Firestore.
- Autenticación de Firebase desde la extensión.
- Adjuntos, notas de voz, estimates o invoices.

## Instalar sin publicar

1. Descarga o copia esta carpeta completa en la computadora.
2. Abre Chrome y entra a `chrome://extensions`.
3. Activa **Developer mode / Modo de desarrollador**.
4. Pulsa **Load unpacked / Cargar descomprimida**.
5. Selecciona esta carpeta, la que contiene `manifest.json`.
6. Abre `https://web.whatsapp.com/` e inicia sesión.
7. Pulsa el icono de extensiones, fija **DEMAC WhatsApp AI Copilot** y ábrelo.
8. Selecciona un chat de prueba y pulsa **Leer chat**.
9. Pulsa **Generar borrador**, revisa el texto y después **Insertar en WhatsApp**.

No es necesario publicar la extensión para usarla en las computadoras de DEMAC durante desarrollo y pruebas. Chrome puede mostrar una advertencia de que hay una extensión cargada en modo de desarrollador; es normal.

## Configurar un backend

Desde **Ajustes**, establece un endpoint HTTPS de DEMAC. El endpoint recibe:

```json
{
  "channel": "whatsapp-web-copilot",
  "company": "DEMAC Professional Cooling Solutions",
  "operator": "Operaciones",
  "languageMode": "auto",
  "conversation": {
    "chatTitle": "Cliente",
    "messages": [
      { "direction": "inbound", "text": "Necesito una cita" }
    ]
  }
}
```

Y debe responder:

```json
{
  "draft": "Buenas tardes...",
  "source": "openai",
  "warning": ""
}
```

La clave de OpenAI debe permanecer exclusivamente en el backend.

## Limitaciones técnicas

WhatsApp Web cambia su estructura interna con frecuencia. Los selectores de lectura e inserción están centralizados en `content.js` para facilitar ajustes después de probarlos contra la sesión real de DEMAC.
