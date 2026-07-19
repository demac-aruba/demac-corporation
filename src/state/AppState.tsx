import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  demoClients,
  demoEquipment,
  demoInventory,
  demoInvoices,
  demoServices,
  demoUsers,
  demoVans,
  demoWorkOrders,
} from '../data/demo';
import {
  clearFirebaseSession,
  deleteFirestoreDocument,
  FirebaseSession,
  getFirebaseUserProfile,
  getValidFirebaseSession,
  isFirebaseConfigured,
  listFirestoreCollection,
  saveFirestoreDocument,
  signInWithFirebaseEmail,
  updateFirestoreDocument,
} from '../services/firebase';
import { Client, InventoryItem, Invoice, Property, ServiceType, User, UserRole, WhatsAppLocationMessage, WorkOrder, WorkOrderEvidence } from '../types';

const STORAGE_KEY = '@demac-corporation-demo-state-v3';
const FIRESTORE_SYNC_INTERVAL_MS = 30_000;
const DEFAULT_FIREBASE_ROLE: UserRole = 'office';

const demoProperties: Property[] = demoClients.map((client, index) => ({
  id: `demo-property-${client.id}`,
  clientId: client.id,
  name: index === 0 ? 'Residencia principal' : 'Propiedad principal',
  type: 'Casa',
  address: client.address,
  zone: client.zone,
  active: true,
}));

const normalizedDemoServices: ServiceType[] = demoServices.map((service, index) => ({
  ...service,
  itemType: 'Servicio',
  active: true,
  featured: index < 6,
}));

type PersistedState = {
  clients: Client[];
  properties: Property[];
  services: ServiceType[];
  workOrders: WorkOrder[];
  workOrderEvidence: WorkOrderEvidence[];
  inventory: InventoryItem[];
  invoices: Invoice[];
};

export type OperationResult = { ok: boolean; message?: string };
type LoginResult = Promise<OperationResult>;

type AppStateValue = {
  currentUser: User | null;
  users: User[];
  clients: Client[];
  properties: Property[];
  equipment: typeof demoEquipment;
  services: ServiceType[];
  vans: typeof demoVans;
  workOrders: WorkOrder[];
  workOrderEvidence: WorkOrderEvidence[];
  inventory: InventoryItem[];
  invoices: Invoice[];
  whatsappLocations: WhatsAppLocationMessage[];
  hydrated: boolean;
  authLoading: boolean;
  dataLoading: boolean;
  dataError: string | null;
  lastSyncedAt: string | null;
  login: (email: string, password: string) => LoginResult;
  loginDemo: (email: string) => OperationResult;
  loginAs: (userId: string) => void;
  logout: () => Promise<void>;
  addClient: (client: Client) => Promise<OperationResult>;
  updateClient: (id: string, changes: Partial<Client>) => Promise<OperationResult>;
  deleteTestClient: (id: string) => Promise<OperationResult>;
  addProperty: (property: Property) => Promise<OperationResult>;
  updateProperty: (id: string, changes: Partial<Property>) => Promise<OperationResult>;
  removeProperty: (id: string) => Promise<OperationResult>;
  addCatalogItem: (item: ServiceType) => Promise<OperationResult>;
  updateCatalogItem: (id: string, changes: Partial<ServiceType>) => Promise<OperationResult>;
  removeCatalogItem: (id: string) => Promise<OperationResult>;
  addWorkOrder: (order: WorkOrder) => Promise<OperationResult>;
  updateWorkOrder: (id: string, changes: Partial<WorkOrder>) => Promise<OperationResult>;
  addWorkOrderEvidence: (evidence: WorkOrderEvidence) => Promise<OperationResult>;
  removeWorkOrderEvidence: (id: string) => Promise<OperationResult>;
  refreshOperationalData: () => Promise<void>;
  clearDataError: () => void;
  adjustInventory: (id: string, quantityDelta: number) => void;
  registerPayment: (invoiceId: string, amount: number) => void;
  resetDemo: () => Promise<void>;
};

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

function buildFirebaseUser(session: FirebaseSession, profile?: Partial<User>): User {
  return {
    id: session.uid,
    name: profile?.name ?? session.displayName ?? session.email ?? 'Usuario DEMAC',
    email: session.email ?? profile?.email ?? '',
    role: profile?.role ?? DEFAULT_FIREBASE_ROLE,
    phone: profile?.phone,
    vanId: profile?.vanId,
    active: profile?.active ?? true,
    authProvider: 'firebase',
  };
}

async function loadFirebaseProfile(session: FirebaseSession) {
  return (await getFirebaseUserProfile(session.uid, session.idToken)) as Partial<User> | undefined;
}

function friendlyDataError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('permission') || normalized.includes('insufficient') || normalized.includes('denied')) {
    return 'Firebase rechazó la operación. Las reglas de Firestore deben permitir clientes, propiedades, catálogo y órdenes para tu rol.';
  }
  if (normalized.includes('session') || normalized.includes('sesión') || normalized.includes('token')) {
    return 'Tu sesión venció. Cierra sesión e inicia nuevamente.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'No se pudo conectar con Firebase. Revisa la conexión e intenta nuevamente.';
  }
  return `No se pudieron sincronizar los datos reales: ${message}`;
}

function sortClients(items: Client[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function sortProperties(items: Property[]) {
  return [...items].sort((a, b) => `${a.clientId}-${a.name}`.localeCompare(`${b.clientId}-${b.name}`));
}

function sortCatalog(items: ServiceType[]) {
  return [...items].sort((a, b) => {
    const typeA = a.itemType ?? 'Servicio';
    const typeB = b.itemType ?? 'Servicio';
    return `${typeA}-${a.name}`.localeCompare(`${typeB}-${b.name}`);
  });
}

function sortWorkOrders(items: WorkOrder[]) {
  return [...items].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [clients, setClients] = useState<Client[]>(demoClients);
  const [properties, setProperties] = useState<Property[]>(demoProperties);
  const [services, setServices] = useState<ServiceType[]>(normalizedDemoServices);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(demoWorkOrders);
  const [workOrderEvidence, setWorkOrderEvidence] = useState<WorkOrderEvidence[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>(demoInventory);
  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);
  const [whatsappLocations, setWhatsappLocations] = useState<WhatsAppLocationMessage[]>([]);
  const [localHydrated, setLocalHydrated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshOperationalData = useCallback(async (showLoader = true) => {
    if (showLoader) setDataLoading(true);
    try {
      const [remoteClients, remoteProperties, remoteServices, remoteWorkOrders, remoteEvidence, remoteWhatsappMessages] = await Promise.all([
        listFirestoreCollection<Client>('clients'),
        listFirestoreCollection<Property>('properties'),
        listFirestoreCollection<ServiceType>('services'),
        listFirestoreCollection<WorkOrder>('workOrders'),
        listFirestoreCollection<WorkOrderEvidence>('workOrderEvidence'),
        listFirestoreCollection<WhatsAppLocationMessage>('whatsappMessages'),
      ]);
      setClients(sortClients(remoteClients));
      setProperties(sortProperties(remoteProperties));
      setServices(sortCatalog(remoteServices));
      setWorkOrders(sortWorkOrders(remoteWorkOrders));
      setWorkOrderEvidence([...remoteEvidence].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
      setWhatsappLocations(remoteWhatsappMessages.map((message) => ({
        ...message,
        latitude: Number(message.latitude ?? message.raw?.location?.latitude),
        longitude: Number(message.longitude ?? message.raw?.location?.longitude),
        locationName: message.locationName ?? message.raw?.location?.name,
        locationAddress: message.locationAddress ?? message.raw?.location?.address,
        locationUrl: message.locationUrl ?? message.raw?.location?.url,
      })).filter((message) => message.direction === 'inbound' && message.type === 'location' && Number.isFinite(message.latitude) && Number.isFinite(message.longitude)));

      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      console.warn('No se pudieron sincronizar clientes, propiedades, catálogo y órdenes:', error);
      setDataError(friendlyDataError(error));
    } finally {
      if (showLoader) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<PersistedState>;
          if (Array.isArray(parsed.clients)) setClients(parsed.clients);
          if (Array.isArray(parsed.properties)) setProperties(parsed.properties);
          if (Array.isArray(parsed.services)) setServices(parsed.services);
          if (Array.isArray(parsed.workOrders)) setWorkOrders(parsed.workOrders);
          if (Array.isArray(parsed.workOrderEvidence)) setWorkOrderEvidence(parsed.workOrderEvidence);
          if (Array.isArray(parsed.inventory)) setInventory(parsed.inventory);
          if (Array.isArray(parsed.invoices)) setInvoices(parsed.invoices);
        }
      } catch (error) {
        console.warn('No se pudo cargar el estado DEMO:', error);
      } finally {
        setLocalHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await getValidFirebaseSession();
        if (!active || !session) return;
        const profile = await loadFirebaseProfile(session);
        const user = buildFirebaseUser(session, profile);
        if (!user.active) return;
        setCurrentUser(user);
        setClients([]);
        setProperties([]);
        setServices([]);
        setWorkOrders([]);
        setWorkOrderEvidence([]);
        await refreshOperationalData(true);
      } catch (error) {
        console.warn('No se pudo restaurar la sesión de Firebase:', error);
        await clearFirebaseSession();
      } finally {
        if (active) setAuthLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshOperationalData]);

  useEffect(() => {
    if (currentUser?.authProvider !== 'firebase') return undefined;
    const timer = setInterval(() => { void refreshOperationalData(false); }, FIRESTORE_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentUser?.id, currentUser?.authProvider, refreshOperationalData]);

  useEffect(() => {
    if (!localHydrated || currentUser?.authProvider === 'firebase') return;
    const state: PersistedState = { clients, properties, services, workOrders, workOrderEvidence, inventory, invoices };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) => {
      console.warn('No se pudo guardar el estado DEMO:', error);
    });
  }, [clients, properties, services, workOrders, inventory, invoices, localHydrated, currentUser?.authProvider]);

  const restoreDemoData = () => {
    setClients(demoClients);
    setProperties(demoProperties);
    setServices(normalizedDemoServices);
    setWorkOrders(demoWorkOrders);
    setWorkOrderEvidence([]);
    setInventory(demoInventory);
    setInvoices(demoInvoices);
    setWhatsappLocations([]);
    setDataError(null);
    setLastSyncedAt(null);
  };

  const loginDemo = (email: string) => {
    const user = demoUsers.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) return { ok: false, message: 'Correo DEMO no encontrado.' };
    if (!user.active) return { ok: false, message: 'Este usuario DEMO está inactivo.' };
    restoreDemoData();
    setCurrentUser(user);
    return { ok: true };
  };

  const login = async (email: string, password: string) => {
    if (!isFirebaseConfigured) return { ok: false, message: 'Firebase no está configurado para este entorno.' };
    try {
      const session = await signInWithFirebaseEmail(email.trim(), password);
      const profile = await loadFirebaseProfile(session);
      const user = buildFirebaseUser(session, profile);
      if (!user.active) {
        await clearFirebaseSession();
        return { ok: false, message: 'Este usuario está inactivo.' };
      }
      setCurrentUser(user);
      setClients([]);
      setProperties([]);
      setServices([]);
      setWorkOrders([]);
      setWorkOrderEvidence([]);
      await refreshOperationalData(true);
      return { ok: true };
    } catch (error) {
      console.warn('No se pudo iniciar sesión con Firebase:', error);
      return { ok: false, message: 'Correo o contraseña incorrectos.' };
    }
  };

  const loginAs = (userId: string) => {
    const user = demoUsers.find((candidate) => candidate.id === userId);
    if (user) setCurrentUser(user);
  };

  const logout = async () => {
    if (currentUser?.authProvider === 'firebase') await clearFirebaseSession();
    setCurrentUser(null);
    restoreDemoData();
  };

  const addClient = async (client: Client): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setClients((previous) => sortClients([client, ...previous]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('clients', client);
      setClients((previous) => sortClients([client, ...previous.filter((item) => item.id !== client.id)]));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const updateClient = async (id: string, changes: Partial<Client>): Promise<OperationResult> => {
    const existing = clients.find((client) => client.id === id);
    if (!existing) return { ok: false, message: 'El cliente ya no existe.' };
    const updated: Client = { ...existing, ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };
    if (currentUser?.authProvider !== 'firebase') {
      setClients((previous) => sortClients(previous.map((client) => client.id === id ? updated : client)));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('clients', updated);
      setClients((previous) => sortClients(previous.map((client) => client.id === id ? updated : client)));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };


const deleteTestClient = async (id: string): Promise<OperationResult> => {
  const existing = clients.find((client) => client.id === id);
  if (!existing) return { ok: false, message: 'El cliente ya no existe.' };
  if (!['admin', 'supervisor'].includes(currentUser?.role ?? '')) {
    return { ok: false, message: 'Solamente un administrador o supervisor puede eliminar datos definitivamente.' };
  }

  const linkedOrders = workOrders.filter((order) => order.clientId === id);
  const protectedOrders = linkedOrders.filter((order) =>
    ['Completada', 'Facturada', 'Pagada'].includes(order.status)
    || order.reportGenerated === true
    || Boolean(order.diagnosis || order.workPerformed || order.customerSignature)
    || Number(order.paid || 0) > 0,
  );
  if (protectedOrders.length || existing.balance > 0) {
    return { ok: false, message: 'Este cliente tiene trabajos, reportes, pagos o balance real. Archívalo en vez de eliminarlo.' };
  }

  const linkedProperties = properties.filter((property) => property.clientId === id);
  if (currentUser?.authProvider !== 'firebase') {
    setWorkOrders((previous) => previous.filter((order) => order.clientId !== id));
    setProperties((previous) => previous.filter((property) => property.clientId !== id));
    setClients((previous) => previous.filter((client) => client.id !== id));
    return { ok: true };
  }

  try {
    const deletedAt = new Date().toISOString();
    await saveFirestoreDocument('clientDeletionLogs', {
      id: `client-deletion-${id}-${Date.now()}`,
      clientId: id,
      clientName: existing.name,
      clientSnapshot: existing,
      propertyIds: linkedProperties.map((property) => property.id),
      workOrderIds: linkedOrders.map((order) => order.id),
      deletedAt,
      deletedById: currentUser?.id ?? '',
      deletedByName: currentUser?.name ?? 'Usuario DEMAC',
      reason: 'Eliminación definitiva de datos de prueba confirmada por el usuario.',
    });
    for (const order of linkedOrders) await deleteFirestoreDocument('workOrders', order.id);
    for (const property of linkedProperties) await deleteFirestoreDocument('properties', property.id);
    await deleteFirestoreDocument('clients', id);
    setWorkOrders((previous) => previous.filter((order) => order.clientId !== id));
    setProperties((previous) => previous.filter((property) => property.clientId !== id));
    setClients((previous) => previous.filter((client) => client.id !== id));
    setDataError(null);
    setLastSyncedAt(deletedAt);
    return { ok: true };
  } catch (error) {
    await refreshOperationalData(false);
    const message = friendlyDataError(error);
    setDataError(message);
    return { ok: false, message };
  }
};

  const addProperty = async (property: Property): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setProperties((previous) => sortProperties([property, ...previous]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('properties', property);
      setProperties((previous) => sortProperties([property, ...previous.filter((item) => item.id !== property.id)]));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };


  const updateProperty = async (id: string, changes: Partial<Property>): Promise<OperationResult> => {
    const existing = properties.find((property) => property.id === id);
    if (!existing) return { ok: false, message: 'La propiedad ya no existe.' };
    const updated: Property = { ...existing, ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };
    if (currentUser?.authProvider !== 'firebase') {
      setProperties((previous) => sortProperties(previous.map((property) => property.id === id ? updated : property)));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('properties', updated);
      setProperties((previous) => sortProperties(previous.map((property) => property.id === id ? updated : property)));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const removeProperty = async (id: string): Promise<OperationResult> => {
    const existing = properties.find((property) => property.id === id);
    if (!existing) return { ok: false, message: 'La propiedad ya no existe.' };
    if (currentUser?.authProvider !== 'firebase') {
      setProperties((previous) => previous.filter((property) => property.id !== id));
      return { ok: true };
    }
    try {
      await deleteFirestoreDocument('properties', id);
      setProperties((previous) => previous.filter((property) => property.id !== id));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const addCatalogItem = async (item: ServiceType): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setServices((previous) => sortCatalog([item, ...previous]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('services', item);
      setServices((previous) => sortCatalog([item, ...previous.filter((service) => service.id !== item.id)]));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const updateCatalogItem = async (id: string, changes: Partial<ServiceType>): Promise<OperationResult> => {
    const existing = services.find((service) => service.id === id);
    if (!existing) return { ok: false, message: 'El artículo ya no existe.' };
    const updated: ServiceType = { ...existing, ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };
    if (currentUser?.authProvider !== 'firebase') {
      setServices((previous) => sortCatalog(previous.map((service) => service.id === id ? updated : service)));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('services', updated);
      setServices((previous) => sortCatalog(previous.map((service) => service.id === id ? updated : service)));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const removeCatalogItem = async (id: string): Promise<OperationResult> => {
    if (workOrders.some((order) => order.serviceId === id)) {
      return { ok: false, message: 'Este servicio tiene trabajos vinculados. Desactívalo en vez de eliminarlo.' };
    }
    if (currentUser?.authProvider !== 'firebase') {
      setServices((previous) => previous.filter((service) => service.id !== id));
      return { ok: true };
    }
    try {
      await deleteFirestoreDocument('services', id);
      setServices((previous) => previous.filter((service) => service.id !== id));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const addWorkOrder = async (order: WorkOrder): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setWorkOrders((previous) => sortWorkOrders([order, ...previous]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('workOrders', order);
      setWorkOrders((previous) => sortWorkOrders([order, ...previous.filter((item) => item.id !== order.id)]));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const updateWorkOrder = async (id: string, changes: Partial<WorkOrder>): Promise<OperationResult> => {
    const existing = workOrders.find((order) => order.id === id);
    if (!existing) return { ok: false, message: 'La orden ya no existe.' };
    const patch = { ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };
    const updated = { ...existing, ...patch };
    if (currentUser?.authProvider !== 'firebase') {
      setWorkOrders((previous) => previous.map((order) => order.id === id ? updated : order));
      return { ok: true };
    }
    try {
      await updateFirestoreDocument('workOrders', id, patch as Record<string, unknown>);
      setWorkOrders((previous) => previous.map((order) => order.id === id ? updated : order));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const genericMessage = friendlyDataError(error);
      const message = currentUser?.role === 'technician' && genericMessage.startsWith('Firebase rechazó')
        ? 'Firebase rechazó este cambio. Confirma que tu cuenta esté vinculada al empleado correcto y que la orden esté asignada a ese técnico o a su van.'
        : genericMessage;
      setDataError(message);
      return { ok: false, message };
    }
  };


  const addWorkOrderEvidence = async (evidence: WorkOrderEvidence): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setWorkOrderEvidence((previous) => [evidence, ...previous.filter((item) => item.id !== evidence.id)]);
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('workOrderEvidence', evidence);
      setWorkOrderEvidence((previous) => [evidence, ...previous.filter((item) => item.id !== evidence.id)]);
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const removeWorkOrderEvidence = async (id: string): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setWorkOrderEvidence((previous) => previous.filter((item) => item.id !== id));
      return { ok: true };
    }
    try {
      await deleteFirestoreDocument('workOrderEvidence', id);
      setWorkOrderEvidence((previous) => previous.filter((item) => item.id !== id));
      setDataError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyDataError(error);
      setDataError(message);
      return { ok: false, message };
    }
  };

  const adjustInventory = (id: string, quantityDelta: number) => {
    setInventory((previous) => previous.map((item) => item.id === id ? { ...item, quantity: Math.max(0, item.quantity + quantityDelta) } : item));
  };

  const registerPayment = (invoiceId: string, amount: number) => {
    setInvoices((previous) => previous.map((invoice) => {
      if (invoice.id !== invoiceId) return invoice;
      const paid = Math.min(invoice.total, invoice.paid + amount);
      return { ...invoice, paid, status: paid >= invoice.total ? 'Pagada' : 'Parcial' };
    }));
  };

  const resetDemo = async () => {
    restoreDemoData();
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo<AppStateValue>(() => ({
    currentUser,
    users: demoUsers,
    clients,
    properties,
    equipment: demoEquipment,
    services,
    vans: demoVans,
    workOrders,
    workOrderEvidence,
    inventory,
    invoices,
    whatsappLocations,
    hydrated: localHydrated && !authLoading && !dataLoading,
    authLoading,
    dataLoading,
    dataError,
    lastSyncedAt,
    login,
    loginDemo,
    loginAs,
    logout,
    addClient,
    updateClient,
    deleteTestClient,
    addProperty,
    updateProperty,
    removeProperty,
    addCatalogItem,
    updateCatalogItem,
    removeCatalogItem,
    addWorkOrder,
    updateWorkOrder,
    addWorkOrderEvidence,
    removeWorkOrderEvidence,
    refreshOperationalData: () => refreshOperationalData(true),
    clearDataError: () => setDataError(null),
    adjustInventory,
    registerPayment,
    resetDemo,
  }), [
    currentUser,
    clients,
    properties,
    services,
    workOrders,
    workOrderEvidence,
    inventory,
    invoices,
    whatsappLocations,
    localHydrated,
    authLoading,
    dataLoading,
    dataError,
    lastSyncedAt,
    refreshOperationalData,
  ]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState debe utilizarse dentro de AppStateProvider');
  return context;
}
