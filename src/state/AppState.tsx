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
} from '../services/firebase';
import { Client, InventoryItem, Invoice, Property, User, UserRole, WorkOrder } from '../types';

const STORAGE_KEY = '@demac-corporation-demo-state-v2';
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

type PersistedState = {
  clients: Client[];
  properties: Property[];
  workOrders: WorkOrder[];
  inventory: InventoryItem[];
  invoices: Invoice[];
};

type OperationResult = { ok: boolean; message?: string };
type LoginResult = Promise<OperationResult>;

type AppStateValue = {
  currentUser: User | null;
  users: User[];
  clients: Client[];
  properties: Property[];
  equipment: typeof demoEquipment;
  services: typeof demoServices;
  vans: typeof demoVans;
  workOrders: WorkOrder[];
  inventory: InventoryItem[];
  invoices: Invoice[];
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
  addProperty: (property: Property) => Promise<OperationResult>;
  removeProperty: (id: string) => Promise<OperationResult>;
  addWorkOrder: (order: WorkOrder) => Promise<OperationResult>;
  updateWorkOrder: (id: string, changes: Partial<WorkOrder>) => Promise<OperationResult>;
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
    return 'Firebase rechazó la operación. Las reglas de Firestore deben permitir clientes, propiedades y órdenes para tu rol.';
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

function sortWorkOrders(items: WorkOrder[]) {
  return [...items].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [clients, setClients] = useState<Client[]>(demoClients);
  const [properties, setProperties] = useState<Property[]>(demoProperties);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(demoWorkOrders);
  const [inventory, setInventory] = useState<InventoryItem[]>(demoInventory);
  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);
  const [localHydrated, setLocalHydrated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshOperationalData = useCallback(async (showLoader = true) => {
    if (showLoader) setDataLoading(true);
    try {
      const [remoteClients, remoteProperties, remoteWorkOrders] = await Promise.all([
        listFirestoreCollection<Client>('clients'),
        listFirestoreCollection<Property>('properties'),
        listFirestoreCollection<WorkOrder>('workOrders'),
      ]);
      setClients(sortClients(remoteClients));
      setProperties(sortProperties(remoteProperties));
      setWorkOrders(sortWorkOrders(remoteWorkOrders));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      console.warn('No se pudieron sincronizar clientes, propiedades y órdenes:', error);
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
          if (Array.isArray(parsed.workOrders)) setWorkOrders(parsed.workOrders);
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
        setWorkOrders([]);
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
    const state: PersistedState = { clients, properties, workOrders, inventory, invoices };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) => {
      console.warn('No se pudo guardar el estado DEMO:', error);
    });
  }, [clients, properties, workOrders, inventory, invoices, localHydrated, currentUser?.authProvider]);

  const loginDemo = (email: string) => {
    const user = demoUsers.find((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) return { ok: false, message: 'Correo DEMO no encontrado.' };
    if (!user.active) return { ok: false, message: 'Este usuario DEMO está inactivo.' };
    setClients(demoClients);
    setProperties(demoProperties);
    setWorkOrders(demoWorkOrders);
    setInventory(demoInventory);
    setInvoices(demoInvoices);
    setDataError(null);
    setLastSyncedAt(null);
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
      setWorkOrders([]);
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
    setClients(demoClients);
    setProperties(demoProperties);
    setWorkOrders(demoWorkOrders);
    setInventory(demoInventory);
    setInvoices(demoInvoices);
    setDataError(null);
    setLastSyncedAt(null);
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
    const updated = { ...existing, ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };
    if (currentUser?.authProvider !== 'firebase') {
      setWorkOrders((previous) => previous.map((order) => (order.id === id ? updated : order)));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('workOrders', updated);
      setWorkOrders((previous) => previous.map((order) => (order.id === id ? updated : order)));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
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
    setClients(demoClients);
    setProperties(demoProperties);
    setWorkOrders(demoWorkOrders);
    setInventory(demoInventory);
    setInvoices(demoInvoices);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo<AppStateValue>(() => ({
    currentUser,
    users: demoUsers,
    clients,
    properties,
    equipment: demoEquipment,
    services: demoServices,
    vans: demoVans,
    workOrders,
    inventory,
    invoices,
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
    addProperty,
    removeProperty,
    addWorkOrder,
    updateWorkOrder,
    refreshOperationalData: () => refreshOperationalData(true),
    clearDataError: () => setDataError(null),
    adjustInventory,
    registerPayment,
    resetDemo,
  }), [
    currentUser,
    clients,
    properties,
    workOrders,
    inventory,
    invoices,
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
