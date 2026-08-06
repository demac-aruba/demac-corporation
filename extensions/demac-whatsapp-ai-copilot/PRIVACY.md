# Privacidad — DEMAC WhatsApp AI Copilot

## Alcance de la versión 0.3.0

- Opera únicamente en `https://web.whatsapp.com/`.
- Lee solo los mensajes visibles del chat abierto.
- No recorre automáticamente todas las conversaciones.
- No contiene ni almacena la clave de OpenAI.
- Puede insertar un borrador o enviarlo únicamente después de una confirmación explícita del operador.

## Transmisión de datos

Sin token de backend configurado, las conversaciones no salen del navegador y se usan respuestas locales.

Cuando Firebase está configurado, se envían al backend seguro de DEMAC:

- nombre visible del chat;
- hasta 30 mensajes visibles recientes, según configuración;
- dirección detectada de cada mensaje;
- último turno agrupado del cliente;
- idioma solicitado y hora de captura.

El token guardado en Chrome no es una clave de OpenAI. Es un token limitado y revocable para proteger la función de Firebase. La clave de OpenAI permanece en Firebase Secret Manager.

## Conservación

La extensión no guarda el texto de las conversaciones en `chrome.storage`. Firebase registra únicamente metadatos operativos mínimos: intención, idioma, etapa, próximo paso, confianza, cantidad de mensajes y fecha. No guarda el texto completo del chat en el registro de auditoría.
