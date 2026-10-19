export type MonitorStatus = 'healthy'|'warning'|'critical'|'unknown';
export type MessageFlow = 'clients'|'technicians'|'other';
export type MonitorItem = {
  id:string; flow:MessageFlow; appointmentId:string; workOrderId:string; vanId:string;
  status:string; createdAtMs:number; totalParts:number; completedParts:number;
};
export type MonitorIncident = {
  id:string; code:string; severity:MonitorStatus; scope:string; flow:string;
  sinceMs:number; openedAtMs:number; count:number; items:MonitorItem[]; truncated?:boolean;
  acknowledgement:{uid:string;name:string;atMs:number}|null;
  open?:boolean; resolvedAtMs?:number|null; verificationUnknown?:boolean;
};
export type MonitorSnapshot = {
  version:1; evaluatedAtMs:number; date:string; status:MonitorStatus; incidents:MonitorIncident[];
  unverifiedIncidents?:MonitorIncident[]; coverage:string[]; queue:MonitorItem[]; queueTruncated:boolean;
  counts:{incidents:number;affected:number;confirmed:number;pending:number;historical:number}; oldestWaitMs:number;
  flows:Record<MessageFlow,{confirmed:number;pending:number;affected:number}>;
  transport:{status:MonitorStatus;lastSuccessAtMs:number|null;lastErrorAtMs:number|null};
  daily:{required:boolean;open?:boolean;dueAtMs?:number;batchPresent?:boolean;batchStatus?:string|null;coverageLate?:boolean;
    preflight?:Record<string,{atMs:number;status:MonitorStatus}>};
  notifications:{configured:boolean;destinationLabel:string;deliveryStatus:'not_observed'};
};
export type MonitorDashboard = {success:true;version:1;enabled:boolean;configured:boolean;canConfigure:boolean;serverAtMs:number;snapshot:MonitorSnapshot|null};
export const MONITOR_PATH = '/settings/system/messaging';
export const monitoringRoles = ['super_admin','operations','office_operator'];
export function monitorFreshness(data:MonitorDashboard|null,error:string,at:number):MonitorStatus {
  if(error || !data?.enabled || !data.snapshot || !Number.isFinite(data.snapshot.evaluatedAtMs))return 'unknown';
  const age=at-data.snapshot.evaluatedAtMs;
  return age>180000 || age < -60000 ? 'unknown' : data.snapshot.status;
}
export function elapsed(ms:number) {
  if(!Number.isFinite(ms)||ms<0)return 'Sin datos';
  if(ms<60000)return `${Math.floor(ms/1000)} s`;
  return `${Math.floor(ms/60000)} min ${Math.floor((ms%60000)/1000)} s`;
}
export const flowLabels:Record<string,string>={clients:'Clientes',technicians:'Técnicos / Vans',other:'Otros envíos',system:'Sistema'};
export const incidentCopy:Record<string,{title:string;detail:string;action:string}>={
  not_generated:{title:'Mensajes que no llegaron a generarse',detail:'Hay una notificación esperada sin registro de envío para esa cita o agenda.',action:'Revisar los registros afectados y coordinar el contacto necesario.'},
  send_failed:{title:'Envíos con fallo confirmado',detail:'La integración informó que estos envíos fallaron.',action:'Revisar el error y la vigencia del mensaje antes de cualquier reintento.'},
  queue_stalled:{title:'Mensajes pendientes sin avanzar',detail:'El tiempo de espera superó el umbral de seguimiento.',action:'Comprobar la conexión y las incidencias anteriores del mismo destinatario.'},
  ack_overdue:{title:'Envío sin confirmación de resultado',detail:'Venció la reserva de envío sin confirmación. El mensaje podría haber salido.',action:'Conciliar el resultado antes de reenviar para evitar duplicados.'},
  send_slow:{title:'Envío en proceso con demora',detail:'El envío sigue reservado y tarda más de lo habitual; aún no hay fallo confirmado.',action:'Observar el progreso del mensaje o archivo sin repetirlo.'},
  recipient_invalid:{title:'Destinatario o grupo sin configuración válida',detail:'Falta un destinatario válido para una notificación esperada.',action:'Corregir el contacto o el grupo desde su configuración habitual.'},
  dependency_unknown:{title:'No se pudo comprobar el orden del envío',detail:'Un mensaje depende de otro cuyo estado no permite verificar su avance.',action:'Revisar la secuencia; no volver a enviar toda la agenda.'},
  record_time_unknown:{title:'Antigüedad del mensaje no verificable',detail:'La fecha del registro no permite calcular su demora con seguridad.',action:'Revisar el registro antes de considerarlo vigente.'},
  transport_unknown:{title:'Conexión sin evidencia reciente',detail:'No se pudo verificar una consulta autenticada del servicio de envío.',action:'Revisar el transporte y el acceso a las señales de salud.'},
  transport_error:{title:'El servicio de envío está devolviendo errores',detail:'Hay un error de transporte posterior a su última consulta correcta.',action:'Revisar el servicio y usar otro medio para las comunicaciones urgentes.'},
  transport_stale:{title:'El servicio dejó de consultar la cola',detail:'La última consulta correcta está fuera del margen esperado.',action:'Revisar la conexión de mensajería antes de que se acumulen envíos.'},
  coverage_incomplete:{title:'La supervisión está incompleta',detail:'Una fuente no pudo comprobarse. Los valores visibles pueden ser parciales.',action:'Restablecer la comprobación; no interpretar la falta de datos como funcionamiento correcto.'},
  schedule_not_run:{title:'No se registró el envío diario de agendas',detail:'La hora programada pasó sin encontrar el lote de generación esperado.',action:'Revisar el proceso de agenda y coordinar los trabajos urgentes con las Vans.'},
};
