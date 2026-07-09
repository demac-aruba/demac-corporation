import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
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
  FirebaseSession,
  getFirebaseUserProfile,
  isFirebaseConfigured,
  getValidFirebaseSession,
  signInWithFirebaseEmail,
} from '../services/firebase';
import { Client, InventoryItem, Invoice, User, UserRole, WorkOrder } from '../types';

const STORAGE_KEY = '@demac-corporation-demo-state-v1';

const DEFAULT_FIREBASE_ROLE: UserRole = 'office';

type PersistedState = {
  clients: Client[];
  workOrders: WorkOrder[];
  inventory: InventoryItem[];
  invoices: Invoice[];
};

type LoginResult = Promise<{ ok: boolean; message?: string }>;

type AppStateValue = {
  currentUser: User | null;
  users: User[];
  clients: Client[];
  equipment: typeof demoEquipment;
  services: typeof demoServices;
  vans: typeof demoVans;
  workOrders: WorkOrder[];
  inventory: InventoryItem[];
  invoices: Invoice[];
  hydrated: boolean;
  authLoading: boolean;
  login: (email: string, password: string) => LoginResult;
  loginDemo: (email: string) => { ok: boolean; message?: string };
  loginAs: (userId: string) => void;
  logout: () => Promise<void>;
  addClient: (client: Client) => void;
  addWorkOrder: (order: WorkOrder) => void;
  updateWorkOrder: (id: string, changes: Partial<WorkOrder>) => void;
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

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [clients, setClients] = useState<Client[]>(demoClients);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(demoWorkOrders);
  const [inventory, setInventory] = useState<InventoryItem[]>(demoInventory);
  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);
  const [hydrated, setHydrated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PersistedState;
          if (Array.isArray(parsed.clients)) setClients(parsed.clients);
          if (Array.isArray(parsed.workOrders)) setWorkOrders(parsed.workOrders);
          if (Array.isArray(parsed.inventory)) setInventory(parsed.inventory);
          if (Array.isArray(parsed.invoices)) setInvoices(parsed.invoices);
        }
      } catch (error) {
        console.warn('No se pudo cargar el estado DEMO:', error);
      } finally {
        setHydrated(true);
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
        setCurrentUser(user.active ? user : null);
      } catch (error) {
        console.warn('No se pudo restaurar la sesión de Firebase:', error);
        await clearFirebaseSession();
      } finally {
        if (active) setAuthLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state: PersistedState = { clients, workOrders, inventory, invoices };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch((error) => {
      console.warn('No se pudo guardar el estado DEMO:', error);
    });
  }, [clients, workOrders, inventory, invoices, hydrated]);

  const loginDemo = (email: string) => {
    const user = demoUsers.find(
      (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!user) return { ok: false, message: 'Correo DEMO no encontrado.' };
    if (!user.active) return { ok: false, message: 'Este usuario DEMO está inactivo.' };
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
  };

  const addClient = (client: Client) => setClients((previous) => [client, ...previous]);
  const addWorkOrder = (order: WorkOrder) => setWorkOrders((previous) => [order, ...previous]);
  const updateWorkOrder = (id: string, changes: Partial<WorkOrder>) => {
    setWorkOrders((previous) => previous.map((order) => (order.id === id ? { ...order, ...changes } : order)));
  };
  const adjustInventory = (id: string, quantityDelta: number) => {
    setInventory((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(0, item.quantity + quantityDelta) } : item,
      ),
    );
  };
  const registerPayment = (invoiceId: string, amount: number) => {
    setInvoices((previous) =>
      previous.map((invoice) => {
        if (invoice.id !== invoiceId) return invoice;
        const paid = Math.min(invoice.total, invoice.paid + amount);
        return { ...invoice, paid, status: paid >= invoice.total ? 'Pagada' : 'Parcial' };
      }),
    );
  };
  const resetDemo = async () => {
    setClients(demoClients);
    setWorkOrders(demoWorkOrders);
    setInventory(demoInventory);
    setInvoices(demoInvoices);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo<AppStateValue>(
    () => ({
      currentUser,
      users: demoUsers,
      clients,
      equipment: demoEquipment,
      services: demoServices,
      vans: demoVans,
      workOrders,
      inventory,
      invoices,
      hydrated: hydrated && !authLoading,
      authLoading,
      login,
      loginDemo,
      loginAs,
      logout,
      addClient,
      addWorkOrder,
      updateWorkOrder,
      adjustInventory,
      registerPayment,
      resetDemo,
    }),
    [currentUser, clients, workOrders, inventory, invoices, hydrated, authLoading],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState debe utilizarse dentro de AppStateProvider');
  return context;
}
