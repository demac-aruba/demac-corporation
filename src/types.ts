export type UserRole = 'admin' | 'office' | 'supervisor' | 'technician' | 'accounting' | 'inventory';

export type ScreenKey =
  | 'dashboard'
  | 'agenda'
  | 'clients'
  | 'catalog'
  | 'workOrders'
  | 'reportReview'
  | 'team'
  | 'technician'
  | 'sales'
  | 'inventory'
  | 'employees'
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

export type StaffEmployeeType = 'Técnico' | 'Secretaria' | 'Administración' | 'Otro';
export type StaffRole = 'Técnico responsable' | 'Técnico' | 'Ayudante' | 'Supervisor' | 'Secretaria' | 'Administración' | 'Contabilidad' | 'Almacén' | 'Otro';
export type StaffAvailability = 'Disponible' | 'Enfermo' | 'Vacaciones' | 'Libre' | 'Inactivo';

export interface StaffProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: StaffRole;
  employeeType?: StaffEmployeeType;
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

export interface Van {
  id: string;
  name: string;
  plate: string;
  driverId?: string;
  technicianIds: string[];
  status: VanOperationalStatus;
  notes?: string;
  tools: VanToolItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  vanId?: string;
  staffId?: string;
  active: boolean;
  authProvider?: 'demo' | 'firebase';
}

export interface PropertyLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  url?: string;
  receivedAt?: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  zone?: string;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Property {
  id: string;
  clientId: string;
  name: string;
  type: string;
  address: string;
  zone?: string;
  active: boolean;
  location?: PropertyLocation;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ServiceType {
  id: string;
  name: string;
  description?: string;
  itemType?: 'Servicio' | 'Producto';
  active?: boolean;
  featured?: boolean;
  defaultDurationMinutes?: number;
  price?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkOrderScheduleHistoryEntry {
  id: string;
  action: string;
  at: string;
  byUserId?: string;
  byName?: string;
  note?: string;
}

export type SchedulingMode = 'exact_time' | 'morning' | 'afternoon' | 'anytime';

export interface AppointmentNotificationRecipient {
  name: string;
  phone: string;
  relationship?: string;
}

export interface WhatsAppLocationMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  from?: string;
  to?: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  locationAddress?: string;
  locationUrl?: string;
  timestamp?: string;
  raw?: any;
}

export interface WorkOrderStatusHistoryEntry {
  status: AppointmentStatus;
  changedAt: string;
  changedByUserId?: string;
  changedByName?: string;
  note?: string;
}

export interface WorkOrderUnitPhoto {
  id: string;
  uri: string;
  type: string;
  section: string;
  takenAt: string;
  takenBy: string;
}

export type WorkOrderUnitStatus = 'not_started' | 'in_progress' | 'completed' | 'pending' | 'not_accessible';

export interface UnitMeasurements {
  lowPressure?: string;
  highPressure?: string;
  returnTemp?: string;
  supplyTemp?: string;
  amperage?: string;
  refrigerant?: string;
  ambientTemp?: string;
  notes?: string;
}

export interface DisconnectInspection {
  safetyConfirmed: boolean;
  condition: 'Buen estado' | 'Requiere mantenimiento' | 'Reemplazo recomendado' | 'Peligro de seguridad' | 'No inspeccionado';
  notes?: string;
}

export interface UnitFinding {
  id: string;
  category: string;
  severity: 'Informativo' | 'Mantenimiento recomendado' | 'Urgente' | 'Peligro de seguridad';
  description: string;
  clientInformed: boolean;
  createdAt: string;
  createdByName: string;
}

export interface WorkOrderUnit {
  id: string;
  workOrderId: string;
  equipmentId?: string;
  label: string;
  sequence: number;
  status: WorkOrderUnitStatus;
  skippedItems?: Record<string, string>;
  initialMeasurements?: UnitMeasurements;
  finalMeasurements?: UnitMeasurements;
  disconnectInspection: DisconnectInspection;
  findings?: UnitFinding[];
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  createdByName: string;
}

export type EvidenceSection =
  | 'identification'
  | 'before_service'
  | 'initial_pressures'
  | 'electrical_disconnect'
  | 'during_service'
  | 'final_pressures'
  | 'after_service'
  | 'finding'
  | 'general';

export type EvidenceMoment = 'before' | 'during' | 'after' | 'not_applicable';

export interface WorkOrderEvidence {
  id: string;
  workOrderId: string;
  unitId?: string;
  equipmentId?: string;
  section: EvidenceSection;
  itemKey: string;
  label: string;
  moment: EvidenceMoment;
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  note?: string;
  capturedAt: string;
  uploadedAt: string;
  uploadedByUserId: string;
  uploadedByStaffId?: string;
  uploadedByName: string;
  updatedAt?: string;
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
  locationSnapshot?: PropertyLocation;
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
  status: 'Pendiente' | 'Parcial' | 'Pagada' | 'Vencida';
}
