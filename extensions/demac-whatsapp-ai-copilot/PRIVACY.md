# Privacidad — DEMAC WhatsApp AI Copilot

## Alcance de la versión 0.1.0

- La extensión opera únicamente en `https://web.whatsapp.com/`.
- Lee únicamente los mensajes visibles del chat que el operador tiene abierto.
- No recorre automáticamente la lista completa de conversaciones.
- No envía mensajes automáticamente.
- Inserta un borrador en el campo de composición para revisión humana.
- No contiene ni almacena una clave de OpenAI.

## Transmisión de datos

Sin un endpoint configurado, la extensión no transmite conversaciones fuera del navegador y utiliza un generador local de prueba.

Cuando se configure un endpoint seguro de DEMAC, la extensión enviará al backend solamente:

- nombre visible del chat abierto;
- últimos mensajes visibles, hasta el límite configurado;
- fecha y hora de captura;
- configuración de idioma y nombre del operador.

El backend debe exigir autenticación de un empleado autorizado, registrar auditoría y mantener las claves de OpenAI exclusivamente en Firebase Secret Manager.

## Conservación

La versión inicial no guarda el contenido de las conversaciones en `chrome.storage`. Solo guarda configuración no sensible, como el endpoint y el máximo de mensajes visibles.
