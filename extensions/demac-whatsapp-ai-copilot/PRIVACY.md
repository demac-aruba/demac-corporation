# Privacidad — DEMAC WhatsApp AI Copilot

## Alcance de la versión 0.4.1

- Opera únicamente en `https://web.whatsapp.com/`.
- Lee solo los mensajes visibles del chat abierto.
- No recorre automáticamente todas las conversaciones.
- No contiene ni almacena la clave de OpenAI.
- Puede insertar o enviar un mensaje únicamente después de una acción explícita del operador.
- Conserva saltos de línea y formato visual al transferir el borrador hacia el compositor de WhatsApp Web.
- Puede consultar la agenda interna de DEMAC. La cita se crea solamente cuando el cliente selecciona una opción y el operador aprueba **Enviar ahora**.

## Transmisión de datos

Cuando Firebase está configurado, se envían al backend seguro de DEMAC:

- nombre visible del chat;
- hasta la cantidad configurada de mensajes visibles recientes;
- identificadores técnicos necesarios para distinguir entrada y salida y, cuando WhatsApp lo incluye, reconocer el número del contacto;
- último turno agrupado del cliente;
- idioma solicitado y hora de captura.

El token guardado en Chrome no es una clave de OpenAI. Es un token limitado y revocable para proteger la función de Firebase. La clave de OpenAI permanece en Firebase Secret Manager.

## Uso dentro del ERP

Firebase consulta únicamente información operativa necesaria para calcular opciones, como órdenes existentes, duración, propiedades, sectores, vans, personal asignado, ausencias, cierres y tardes libres.

Cuando el cliente confirma una opción y el operador aprueba el envío:

- el horario se comprueba nuevamente para impedir doble reserva;
- se crea la orden principal y, si hace falta, las asignaciones internas de apoyo;
- se reutiliza el cliente y la propiedad cuando pueden identificarse de forma segura;
- no se utiliza el nombre visible del chat como nombre legal de un cliente nuevo.

## Conservación

La extensión no guarda el texto de las conversaciones en `chrome.storage`.

Firebase conserva metadatos mínimos de auditoría, las opciones temporales necesarias para revalidar la reserva y los registros normales del ERP creados durante el proceso.
