export type UserRole = 'admin' | 'office' | 'supervisor' | 'technician' | 'accounting' | 'inventory';

export type ScreenKey =
  | 'dashboard'
  | 'agenda'
  | 'clients'
  | 'catalog'
  | 'workOrders'
  | 'team'
  | 'technician'
  | 'sales'
  | 'inventory'
  | 'finance'
  | 'settings';

export type AppointmentStatus =
  | 'Solicitud recibida'
  | 'Reserva temporal'
  | 'Confirmada'
  | 'Asignada'
  | 'En camino'
  | 'En el sitio'
  | 'En proceso'
  | 'Pendiente'
  | 'Completada'
  | 'Facturada'
  | 'Pagada'
  | 'Reprogramada'
  | 'Cancelada';

export type StaffRole = 'Técnico responsable' | 'Técnico' | 'Ayudante' | 'Supervisor';
export type StaffAvailability = 'Disponible' | 'Enfermo' | 'Vacaciones' | 'Libre' | 'Inactivo';

export interface StaffProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: StaffRole;
  canDriveVan: boolean;
  primaryVanId?: string;
  skills: string[];
  availability: StaffAvailability;
  unavailableFrom?: string;
  unavailableUntil?: string;
  licenseNumber?: string;
  licenseExpiresAt?: string;
  active: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StaffAbsence {
  id: string;
  staffId: string;
  fromDate: string;
  toDate: string;
  reason: 'Enfermo' | 'Vacaciones' | 'Libre' | 'Otro';
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type VanOperationalStatus = 'Disponible' | 'En ruta' | 'Mantenimiento' | 'Fuera de servicio' | 'Sin personal';
export type VanToolCondition = 'Buena' | 'Requiere atención' | 'Fuera de servicio';

export interface VanToolItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  condition: VanToolCondition;
  notes?: string;
}

export interface DailyVanAssignment {
  id: string;
  date: string;
  vanId: string;
  driverStaffId?: string;
  helperStaffId?: string;
  status: 'Disponible' | 'Trabajo liviano' | 'Sin personal' | 'Mantenimiento' | 'Fuera de servicio';
  notes?: string;
  updatedAt?: string;
}

export interface VanMaintenanceLog {
  id: string;
  vanId: string;
  date: string;
  odometerKm: number;
  type: string;
  description: string;
  cost?: number;
  nextDueKm?: number;
  nextDueDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  authProvider?: 'demo' | 'firebase';
  role: UserRole;
  phone?: string;
  vanId?: string;
  active: boolean;
}


export type PreferredLanguage = 'Español' | 'English' | 'Nederlands' | 'Papiamento';

export type ClientLifecycleAction = 'Creado' | 'Archivado' | 'Restaurado' | 'Teléfono compartido' | 'Teléfono reasignado';

export interface ClientLifecycleEntry {
  id: string;
  action: ClientLifecycleAction;
  reason: string;
  performedAt: string;
  performedById?: string;
  performedByName: string;
}

export interface ClientPhoneHistoryEntry {
  id: string;
  phone: string;
  whatsapp: string;
  action: 'Compartido' | 'Reasignado';
  reason: string;
  changedAt: string;
  changedById?: string;
  changedByName: string;
}

export interface Client {

  id: string;
  name: string;
  company?: string;
  phone: string;
  phoneCountry?: string;
  whatsapp: string;
  whatsappCountry?: string;
  email?: string;
  preferredLanguage?: PreferredLanguage;
  templateLanguage?: 'en' | 'es' | 'nl';
  address: string;
  zone: string;
  balance: number;
  equipmentCount: number;
  lastService?: string;
  active?: boolean;
  archivedAt?: string;
  archivedById?: string;
  archivedByName?: string;
  archiveReason?: string;
  phoneSharedWithClientIds?: string[];
  phoneSharedReason?: string;
  phoneHistory?: ClientPhoneHistoryEntry[];
  lifecycleHistory?: ClientLifecycleEntry[];
  createdAt?: string;
  updatedAt?: string;
}

export type PropertyType = 'Casa' | 'Apartamento' | 'Oficina' | 'Local comercial' | 'Otro';

export type PropertyContactRole = 'Dueño' | 'Encargado' | 'Administrador' | 'Inquilino' | 'Contacto de acceso' | 'Contabilidad' | 'Otro';
export type PropertyContactLanguage = PreferredLanguage;

export interface PropertyContact {
  id: string;
  name: string;
  role: PropertyContactRole;
  phone: string;
  phoneCountry?: string;
  whatsapp: string;
  whatsappCountry?: string;
  email?: string;
  preferredLanguage: PropertyContactLanguage;
  defaultSendConfirmation?: boolean;
  defaultSendReminder?: boolean;
  arrivalContact?: boolean;
  active: boolean;
  inactiveReason?: string;
  archivedAt?: string;
  archivedById?: string;
  archivedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Property {
  id: string;
  clientId: string;
  name: string;
  type: PropertyType;
  address: string;
  zone: string;
  notes?: string;
  contacts?: PropertyContact[];
  active: boolean;
  archivedAt?: string;
  archivedById?: string;
  archivedByName?: string;
  archiveReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AppointmentNotificationRecipientType = 'client' | 'propertyContact';

export interface AppointmentNotificationRecipient {
  id: string;
  recipientType: AppointmentNotificationRecipientType;
  sourceId: string;
  name: string;
  role: string;
  phone: string;
  phoneCountry?: string;
  whatsapp: string;
  whatsappCountry?: string;
  preferredLanguage: PropertyContactLanguage;
  templateLanguage?: 'en' | 'es' | 'nl';
  sendConfirmation: boolean;
  sendReminder: boolean;
}

export interface Equipment {
  id: string;
  clientId: string;
  propertyId?: string;
  location: string;
  brand: string;
  model: string;
  serial: string;
  btu: number;
  type: string;
  refrigerant: 'R32' | 'R410A' | 'R22';
  voltage: '110V' | '220V' | '380V';
  installedAt: string;
  warrantyUntil: string;
  condition: 'Excelente' | 'Buena' | 'Requiere atención' | 'Fuera de servicio';
}

export type CatalogItemType = 'Servicio' | 'Producto';

export interface ServiceType {
  id: string;
  name: string;
  itemType?: CatalogItemType;
  durationMinutes: number;
  basePrice: number;
  category: string;
  description?: string;
  sku?: string;
  active?: boolean;
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type SchedulingMode = 'fixed' | 'perUnit';

export type AppointmentChangeOrigin = 'Cliente' | 'DEMAC' | 'Fuerza mayor' | 'Otro';

export type AppointmentChangeReasonCategory =
  | 'Cliente solicita otra fecha'
  | 'Cliente no puede recibirnos'
  | 'Cliente ya no desea el servicio'
  | 'No se logró contactar al cliente'
  | 'Problema de precio o cotización'
  | 'Dirección o acceso no disponible'
  | 'Error de programación'
  | 'Falta de personal de DEMAC'
  | 'Avería de van o herramientas'
  | 'Condiciones climáticas'
  | 'Otro';

export interface WorkOrderScheduleHistoryEntry {
  id: string;
  date: string;
  time: string;
  vanId: string;
  technicianIds: string[];
  scheduledSlots: number;
  status: 'Cancelada' | 'Reprogramada';
  clientId: string;
  propertyId?: string;
  address: string;
  zone?: string;
  problem: string;
  changeOrigin?: AppointmentChangeOrigin;
  reasonCategory?: AppointmentChangeReasonCategory;
  reasonNote?: string;
  changedByUserId?: string;
  changedByName?: string;
  noticeHours?: number;
  newDate?: string;
  newTime?: string;
  newVanId?: string;
  recordedAt: string;
}

export interface WorkOrder {
  id: string;
  clientId: string;
  propertyId?: string;
  serviceId: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  technicianIds: string[];
  vanId: string;
  address: string;
  zone?: string;
  problem: string;
  officeNotes?: string;
  amount: number;
  paid: number;
  schedulingMode?: SchedulingMode;
  airConditionerCount?: number;
  scheduledSlots?: number;
  whatsappNotificationsEnabled?: boolean;
  notificationRecipients?: AppointmentNotificationRecipient[];
  confirmedAt?: string;
  temporaryReservedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  scheduleHistory?: WorkOrderScheduleHistoryEntry[];
  equipmentId?: string;
  measurements?: {
    voltage?: string;
    amperage?: string;
    lowPressure?: string;
    highPressure?: string;
    returnTemp?: string;
    supplyTemp?: string;
  };
  diagnosis?: string;
  workPerformed?: string;
  recommendation?: string;
  materials?: string[];
  customerSignature?: string;
  photos?: string[];
  reportGenerated?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minimum: number;
  cost: number;
  location: string;
}

export interface Invoice {
  id: string;
  clientId: string;
  workOrderId?: string;
  date: string;
  dueDate: string;
  total: number;
  paid: number;
  status: 'Borrador' | 'Enviada' | 'Parcial' | 'Pagada' | 'Vencida';
  channel: 'Tienda' | 'WhatsApp' | 'Teléfono' | 'Servicio técnico';
}

export interface Van {
  id: string;
  name: string;
  plate: string;
  technicianIds: string[];
  status: VanOperationalStatus;
  responsibleStaffId?: string;
  regularHelperId?: string;
  odometerKm?: number;
  nextServiceKm?: number;
  nextServiceDate?: string;
  insuranceExpiresAt?: string;
  registrationExpiresAt?: string;
  notes?: string;
  inventory?: VanToolItem[];
  active?: boolean;
  updatedAt?: string;
}
