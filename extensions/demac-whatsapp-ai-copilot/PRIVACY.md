# Privacidad — DEMAC WhatsApp AI Copilot

## Alcance de la versión 0.4.9

- Opera únicamente en `https://web.whatsapp.com/`.
- Lee solo los mensajes visibles del chat abierto.
- No recorre automáticamente todas las conversaciones.
- No contiene ni almacena la clave de OpenAI.
- Conserva saltos de línea y formato visual al transferir respuestas hacia WhatsApp Web.
- Consulta reglas, conocimiento y agenda operativa del ERP cuando son necesarios para responder.

## Modo normal supervisado

Por defecto, el operador conserva el control de generación, inserción y envío. Las citas se revalidan antes de crearse en el ERP.

## Modo automático de prueba

La versión 0.4.9 permite activar temporalmente respuestas automáticas para una sola conversación controlada de prueba.

- La activación requiere una acción explícita del operador desde el chat abierto.
- El modo queda vinculado exclusivamente al identificador de esa conversación.
- No se utiliza para otros chats.
- El estado automático vive en el panel lateral y deja de operar al cerrar o recargar ese panel.
- Además, el modo expira automáticamente después de 8 horas.
- El panel consulta periódicamente únicamente el chat abierto para detectar un nuevo mensaje entrante.
- Si una respuesta requiere revisión humana, no se envía automáticamente.
- Si el cliente de prueba confirma una cita, el sistema puede crear una orden real en el ERP después de revalidar disponibilidad; el panel advierte esto antes de activar el modo.
- El envío automático conserva las mismas protecciones contra el micrófono: únicamente se pulsa un botón verificado explícitamente como **Send / Enviar**.

## Memoria local estructurada

Para evitar preguntas repetidas, la extensión guarda en `chrome.storage.local` únicamente datos operativos confirmados, por ejemplo:

- tipo de trabajo;
- cantidad de aires;
- dirección;
- fecha solicitada;
- restricción horaria;
- nombre, cuando el cliente lo haya proporcionado claramente.

La memoria se separa por número técnico de WhatsApp cuando está disponible y, como respaldo, por el título visible del chat. No se guarda una copia completa del texto de la conversación. La extensión conserva como máximo 100 registros de memoria y elimina primero los más antiguos.

## Transmisión de datos

Cuando Firebase está configurado, se envían al backend seguro de DEMAC:

- nombre visible del chat;
- hasta la cantidad configurada de mensajes visibles recientes;
- identificadores técnicos necesarios para distinguir entrada y salida y, cuando WhatsApp lo incluye, reconocer el número del contacto;
- último turno agrupado del cliente;
- datos estructurados ya confirmados para mantener continuidad;
- idioma solicitado y hora de captura.

El token guardado en Chrome no es una clave de OpenAI. Es un token limitado y revocable para proteger la función de Firebase. La clave de OpenAI permanece en Firebase Secret Manager.

## Uso dentro del ERP

Firebase consulta únicamente información operativa necesaria para calcular opciones y respuestas, como órdenes existentes, duración, precios, propiedades, sectores, vans, personal asignado, ausencias, cierres y reglas aprobadas.

Cuando el cliente confirma una opción:

- el horario se comprueba nuevamente para impedir doble reserva;
- se crea la orden principal y, si hace falta, las asignaciones internas de apoyo;
- se reutiliza el cliente y la propiedad cuando pueden identificarse de forma segura;
- no se utiliza el nombre visible del chat como nombre legal de un cliente nuevo.

## Conservación en Firebase

Firebase conserva metadatos mínimos de auditoría, las opciones temporales necesarias para revalidar la reserva y los registros normales del ERP creados durante el proceso. El registro de auditoría no guarda el texto completo del chat.