# Privacidad — DEMAC WhatsApp AI Copilot

## Alcance de la versión 0.4.0

- Opera únicamente en `https://web.whatsapp.com/`.
- Lee solo los mensajes visibles del chat abierto.
- No recorre automáticamente todas las conversaciones.
- No contiene ni almacena la clave de OpenAI.
- Puede insertar o enviar un mensaje únicamente después de una acción explícita del operador.
- Puede consultar la agenda interna de DEMAC. La cita se crea solamente cuando el cliente selecciona una opción y el operador aprueba **Enviar ahora**.

## Transmisión de datos

Sin token de backend configurado, las conversaciones no salen del navegador. El modo local puede ayudar a recopilar datos, pero no ofrece ni confirma horarios.

Cuando Firebase está configurado, se envían al backend seguro de DEMAC:

- nombre visible del chat;
- hasta 30 mensajes visibles recientes, según configuración;
- identificador técnico de los mensajes necesario para distinguir entrada y salida y, cuando WhatsApp lo incluye, reconocer el número del contacto;
- último turno agrupado del cliente;
- idioma solicitado y hora de captura.

El token guardado en Chrome no es una clave de OpenAI. Es un token limitado y revocable para proteger la función de Firebase. La clave de OpenAI permanece en Firebase Secret Manager.

## Uso dentro del ERP

Para calcular opciones, Firebase consulta únicamente información operativa de DEMAC, como órdenes existentes, duración del trabajo, propiedades, sectores, vans, personal asignado, ausencias, cierres y tardes libres.

Cuando el cliente confirma una opción y el operador aprueba el envío:

- el horario se comprueba nuevamente para impedir una doble reserva;
- se crea la orden principal y, si es necesario, las asignaciones internas de vans de apoyo;
- se reutiliza el cliente y la propiedad existentes cuando pueden identificarse de forma segura;
- cuando el número es identificable pero el cliente todavía no existe, el ERP puede crear un registro provisional `Cliente WhatsApp ####` para revisión de Operaciones;
- no se utiliza el nombre visible del chat como nombre legal del cliente nuevo.

## Conservación

La extensión no guarda el texto de las conversaciones en `chrome.storage`.

Firebase conserva:

- metadatos mínimos de auditoría del Copilot;
- las opciones de agenda ofrecidas durante un máximo operativo de 48 horas;
- la referencia de la opción seleccionada y la orden creada;
- las órdenes, clientes o propiedades creados como parte del proceso normal del ERP.

El registro de auditoría no guarda el texto completo del chat. Las ofertas temporales guardan solamente los datos necesarios para volver a validar y reservar la opción presentada al cliente.
