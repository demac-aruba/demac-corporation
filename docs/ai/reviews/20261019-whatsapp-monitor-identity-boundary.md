# Límite de identidad en la publicación del monitor

Deep Review / Solo Maintainer Adversarial Review; revisión separada, no independiente.
Solicitud vigente: el propietario autorizó merge y deploy del monitor.

PR607 y sus 28 checks completaron; los jobs de despliegue automático estaban excluidos por
diseño. El release controlado 39316901040 falló en prepare-identity, HTTP 403, antes de
modificar fuentes operacionales, crear índices, publicar las funciones nuevas o activar el control.
La inspección de solo lectura 39317349409 confirma IAM habilitado y cuenta dedicada ausente;
el deployer firebase-adminsdk-fbsvc carece de crear identidades y escribir IAM de proyecto.

Se sustituye la provisión desde CI por verificación de una cuenta preparada una sola vez por
un administrador. No se cambian credenciales ni se amplían privilegios del deployer. Se conserva
el servicio dedicado y sus cuatro roles mínimos. El script administrativo es idempotente,
no crea claves y no contiene accesos a datos ni envíos. CI rechaza cuenta ausente/deshabilitada,
roles condicionales o faltantes y Owner/Editor, con pruebas negativas específicas.

Revisión adversarial: comprobar una política no concede privilegios; getIamPolicy se solicita
con versión 3 para no confundir bindings condicionales con incondicionales. La falta de una
cuenta detiene todo el despliegue; no cae a una identidad predeterminada ni usa el deployer como
runtime. El resto del release y su corte prospectivo permanecen iguales. La creación por
administrador sigue pendiente; tampoco hay destinatario externo verificado.

Validación: syntax Node/Bash y 21 pruebas de identidad, release, transporte y recuperación.
El CI del PR adicional debe aprobarse antes de incorporarlo. Este registro no acredita deploy.
