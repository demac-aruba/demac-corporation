export type UserRole = 'admin' | 'office' | 'supervisor' | 'technician' | 'accounting' | 'inventory';

export type ScreenKey =
  | 'dashboard'
  | 'agenda'
  | 'clients'
  | 'catalog'
  | 'workOrders'
  | 'technician'
  | 'sales'
  | 'inventory'
  | 'finance'
  | 'settings';

export type AppointmentStatus =
  | 'Solicitud recibida'
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

export interface Client {
  id: string;
  name: string;
  company?: string;
  phone: string;
  whatsapp: string;
  email?: string;
  address: string;
  zone: string;
  balance: number;
  equipmentCount: number;
  lastService?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PropertyType = 'Casa' | 'Apartamento' | 'Oficina' | 'Local comercial' | 'Otro';

export interface Property {
  id: string;
  clientId: string;
  name: string;
  type: PropertyType;
  address: string;
  zone: string;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  problem: string;
  officeNotes?: string;
  amount: number;
  paid: number;
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
  status: 'Disponible' | 'En ruta' | 'Mantenimiento';
}
