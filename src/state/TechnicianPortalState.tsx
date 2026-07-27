import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { useAppState as useCoreAppState } from './AppState';
import { WorkOrder } from '../types';
import { EquipmentSystem, WorkIntervention, WorkVisit, VisitUnit } from '../features/technicianPortal/contracts';
import { equipmentDocumentIdFromQr, equipmentQrCodesMatch, isValidEquipmentQrCode, normalizeEquipmentQrCode } from '../features/technicianPortal/equipmentQr';

const REFRESH_INTERVAL_MS = 15_000;

export type TechnicianPortalOperationResult = { ok: boolean; message?: string };

export type RegisteredEquipmentSystem = EquipmentSystem & {
  sourceWorkOrderId: string;
  sourceVisitId: string;
};

type PrepareVisitOptions = {
  serviceName?: string;
  leadTechnicianStaffId?: string;
  participatingStaffIds?: string[];
};

type AddVisitUnitInput = {
  visitId: string;
  workOrderId: string;
  locationLabel: string;
  source: VisitUnit['source'];
  equipmentSystemId?: string;
  addedOnSite?: boolean;
  addedReason?: string;
};

type AddInterventionInput = {
  visitId: string;
  visitUnitId: string;
  equipmentSystemId?: string;
  type: WorkIntervention['type'];
  templateId: string;
  templateVersion: number;
  isPrimary: boolean;
  requestedBy?: WorkIntervention['requestedBy'];
  scopeChangeId?: string;
};

type RegisterEquipmentSystemInput = {
  qrCode: string;
  clientId: string;
  propertyId?: string;
  locationLabel: string;
  systemType: string;
  components: EquipmentSystem['components'];
  sourceWorkOrderId: string;
  sourceVisitId: string;
  condition?: string;
};

type TechnicianPortalStateValue = {
  workVisits: WorkVisit[];
  visitUnits: VisitUnit[];
  workInterventions: WorkIntervention[];
  equipmentSystems: RegisteredEquipmentSystem[];
  loading: boolean;
  dataError: string | null;
  lastSyncedAt: string | null;
  refreshTechnicianPortalData: () => Promise<void>;
  saveWorkVisit: (visit: WorkVisit) => Promise<TechnicianPortalOperationResult>;
  saveVisitUnit: (unit: VisitUnit) => Promise<TechnicianPortalOperationResult>;
  saveWorkIntervention: (intervention: WorkIntervention) => Promise<TechnicianPortalOperationResult>;
  saveEquipmentSystem: (equipment: RegisteredEquipmentSystem) => Promise<TechnicianPortalOperationResult>;
  prepareVisitFromWorkOrder: (order: WorkOrder, options?: PrepareVisitOptions) => Promise<{ result: TechnicianPortalOperationResult; visit?: WorkVisit }>;
  addVisitUnit: (input: AddVisitUnitInput) => Promise<{ result: TechnicianPortalOperationResult; unit?: VisitUnit }>;
  addWorkIntervention: (input: AddInterventionInput) => Promise<{ result: TechnicianPortalOperationResult; intervention?: WorkIntervention }>;
  registerEquipmentSystem: (input: RegisterEquipmentSystemInput) => Promise<{ result: TechnicianPortalOperationResult; equipment?: RegisteredEquipmentSystem }>;
  attachEquipmentToVisitUnit: (unit: VisitUnit, equipment: RegisteredEquipmentSystem) => Promise<TechnicianPortalOperationResult>;
};

const TechnicianPortalStateContext = createContext<TechnicianPortalStateValue | undefined>(undefined);

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('permission') || normalized.includes('denied') || normalized.includes('insufficient')) {
    return 'Firebase rechazó el cambio del Portal del Técnico. Publica las reglas nuevas y confirma que el usuario esté asignado a la orden o van.';
  }
  if (normalized.includes('session') || normalized.includes('sesión') || normalized.includes('token')) {
    return 'La sesión de Firebase venció. Cierra sesión e inicia nuevamente.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'No se pudo conectar con Firebase. Revisa la conexión e intenta nuevamente.';
  }
  return `No se pudieron sincronizar los datos del Portal del Técnico: ${message}`;
}

function sortVisits(items: WorkVisit[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortUnits(items: VisitUnit[]) {
  return [...items].sort((a, b) => `${a.visitId}-${String(a.sequence).padStart(4, '0')}`.localeCompare(`${b.visitId}-${String(b.sequence).padStart(4, '0')}`));
}

function sortInterventions(items: WorkIntervention[]) {
  return [...items].sort((a, b) => `${a.visitUnitId}-${a.createdAt}`.localeCompare(`${b.visitUnitId}-${b.createdAt}`));
}

function sortEquipment(items: RegisteredEquipmentSystem[]) {
  return [...items].sort((a, b) => `${a.clientId}-${a.locationLabel}`.localeCompare(`${b.clientId}-${b.locationLabel}`, 'es', { sensitivity: 'base' }));
}

function idPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
}

export function TechnicianPortalStateProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useCoreAppState();
  const [workVisits, setWorkVisits] = useState<WorkVisit[]>([]);
  const [visitUnits, setVisitUnits] = useState<VisitUnit[]>([]);
  const [workInterventions, setWorkInterventions] = useState<WorkIntervention[]>([]);
  const [equipmentSystems, setEquipmentSystems] = useState<RegisteredEquipmentSystem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refreshTechnicianPortalData = useCallback(async (showLoader = true) => {
    if (!currentUser || currentUser.authProvider !== 'firebase') {
      setLoading(false);
      setDataError(null);
      return;
    }
    if (showLoader) setLoading(true);
    try {
      const [remoteVisits, remoteUnits, remoteInterventions, remoteEquipment] = await Promise.all([
        listFirestoreCollection<WorkVisit>('workVisits'),
        listFirestoreCollection<VisitUnit>('visitUnits'),
        listFirestoreCollection<WorkIntervention>('workInterventions'),
        listFirestoreCollection<RegisteredEquipmentSystem>('equipmentSystems'),
      ]);
      setWorkVisits(sortVisits(remoteVisits));
      setVisitUnits(sortUnits(remoteUnits));
      setWorkInterventions(sortInterventions(remoteInterventions));
      setEquipmentSystems(sortEquipment(remoteEquipment));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      setDataError(friendlyError(error));
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [currentUser?.id, currentUser?.authProvider]);

  useEffect(() => {
    void refreshTechnicianPortalData(true);
  }, [refreshTechnicianPortalData]);

  useEffect(() => {
    if (!currentUser || currentUser.authProvider !== 'firebase') return undefined;
    const timer = setInterval(() => { void refreshTechnicianPortalData(false); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentUser?.id, currentUser?.authProvider, refreshTechnicianPortalData]);

  const actor = useCallback(() => ({
    userId: currentUser?.id ?? 'demo-user',
    staffId: (currentUser as { staffId?: string } | null)?.staffId,
    name: currentUser?.name ?? 'Usuario DEMAC',
  }), [currentUser?.id, currentUser?.name]);

  async function saveDocument<T extends { id: string }>(
    collection: string,
    item: T,
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    sorter: (items: T[]) => T[],
  ): Promise<TechnicianPortalOperationResult> {
    try {
      if (currentUser?.authProvider === 'firebase') await saveFirestoreDocument(collection, item);
      setter((previous) => sorter([item, ...previous.filter((candidate) => candidate.id !== item.id)]));
      setDataError(null);
      setLastSyncedAt(new Date().toISOString());
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setDataError(message);
      return { ok: false, message };
    }
  }

  const saveWorkVisit = (visit: WorkVisit) => saveDocument('workVisits', visit, setWorkVisits, sortVisits);
  const saveVisitUnit = (unit: VisitUnit) => saveDocument('visitUnits', unit, setVisitUnits, sortUnits);
  const saveWorkIntervention = (intervention: WorkIntervention) => saveDocument('workInterventions', intervention, setWorkInterventions, sortInterventions);
  const saveEquipmentSystem = (equipment: RegisteredEquipmentSystem) => saveDocument('equipmentSystems', equipment, setEquipmentSystems, sortEquipment);

  const prepareVisitFromWorkOrder = async (order: WorkOrder, options: PrepareVisitOptions = {}) => {
    const existing = workVisits.find((visit) => visit.workOrderId === order.id);
    if (existing) return { result: { ok: true }, visit: existing };

    const now = new Date().toISOString();
    const currentActor = actor();
    const visit: WorkVisit = {
      id: `visit-${idPart(order.id)}`,
      workOrderId: order.id,
      clientId: order.clientId,
      propertyId: order.propertyId,
      scheduledScopeSnapshot: {
        serviceId: order.serviceId,
        serviceName: options.serviceName,
        estimatedUnitCount: Math.max(1, Number(order.airConditionerCount ?? 1)),
        problemDescription: order.problem,
        technicianInstructions: order.officeNotes,
      },
      status: order.status === 'En camino' ? 'on_the_way'
        : order.status === 'En el sitio' ? 'on_site'
          : order.status === 'En proceso' ? 'in_progress'
            : order.status === 'Pendiente' ? 'pending'
              : order.status === 'Completada' ? 'completed'
                : 'not_started',
      leadTechnicianStaffId: options.leadTechnicianStaffId,
      participatingStaffIds: options.participatingStaffIds ?? [...order.technicianIds],
      requiresSecondVisit: false,
      createdAt: now,
      createdByUserId: currentActor.userId,
      createdByStaffId: currentActor.staffId,
      createdByName: currentActor.name,
      updatedAt: now,
      updatedByUserId: currentActor.userId,
      updatedByStaffId: currentActor.staffId,
      updatedByName: currentActor.name,
      version: 1,
    };
    const result = await saveWorkVisit(visit);
    return { result, visit: result.ok ? visit : undefined };
  };

  const addVisitUnit = async (input: AddVisitUnitInput) => {
    const now = new Date().toISOString();
    const currentActor = actor();
    const sequence = Math.max(0, ...visitUnits.filter((unit) => unit.visitId === input.visitId).map((unit) => unit.sequence)) + 1;
    const defaultAddedOnSite = input.source === 'registered_on_site' || input.source === 'qr_scan';
    const unit: VisitUnit = {
      id: `visit-unit-${idPart(input.visitId)}-${Date.now().toString(36)}`,
      visitId: input.visitId,
      workOrderId: input.workOrderId,
      equipmentSystemId: input.equipmentSystemId,
      sequence,
      locationLabel: input.locationLabel.trim() || `Aire ${sequence}`,
      source: input.source,
      status: 'not_started',
      addedOnSite: input.addedOnSite ?? defaultAddedOnSite,
      addedReason: input.addedReason,
      addedByStaffId: currentActor.staffId,
      createdAt: now,
      createdByUserId: currentActor.userId,
      createdByStaffId: currentActor.staffId,
      createdByName: currentActor.name,
      updatedAt: now,
      updatedByUserId: currentActor.userId,
      updatedByStaffId: currentActor.staffId,
      updatedByName: currentActor.name,
      version: 1,
    };
    const result = await saveVisitUnit(unit);
    return { result, unit: result.ok ? unit : undefined };
  };

  const addWorkIntervention = async (input: AddInterventionInput) => {
    const now = new Date().toISOString();
    const currentActor = actor();
    const intervention: WorkIntervention = {
      id: `intervention-${idPart(input.visitUnitId)}-${Date.now().toString(36)}`,
      visitId: input.visitId,
      visitUnitId: input.visitUnitId,
      equipmentSystemId: input.equipmentSystemId,
      type: input.type,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      isPrimary: input.isPrimary,
      status: 'draft',
      requestedBy: input.requestedBy,
      scopeChangeId: input.scopeChangeId,
      createdAt: now,
      createdByUserId: currentActor.userId,
      createdByStaffId: currentActor.staffId,
      createdByName: currentActor.name,
      updatedAt: now,
      updatedByUserId: currentActor.userId,
      updatedByStaffId: currentActor.staffId,
      updatedByName: currentActor.name,
      version: 1,
    };
    const result = await saveWorkIntervention(intervention);
    return { result, intervention: result.ok ? intervention : undefined };
  };

  const registerEquipmentSystem = async (input: RegisterEquipmentSystemInput) => {
    const qrCode = normalizeEquipmentQrCode(input.qrCode);
    if (!isValidEquipmentQrCode(qrCode)) {
      return { result: { ok: false, message: 'Escanea o escribe el código completo del sticker QR preimpreso.' } };
    }
    const existing = equipmentSystems.find((equipment) => equipmentQrCodesMatch(equipment.qrCode, qrCode));
    if (existing) {
      return { result: { ok: false, message: `Este QR ya pertenece a ${existing.locationLabel}.` }, equipment: existing };
    }

    const now = new Date().toISOString();
    const currentActor = actor();
    const equipment: RegisteredEquipmentSystem = {
      id: equipmentDocumentIdFromQr(qrCode),
      qrCode,
      clientId: input.clientId,
      propertyId: input.propertyId,
      locationLabel: input.locationLabel.trim(),
      systemType: input.systemType,
      components: input.components,
      active: true,
      condition: input.condition,
      sourceWorkOrderId: input.sourceWorkOrderId,
      sourceVisitId: input.sourceVisitId,
      createdAt: now,
      createdByUserId: currentActor.userId,
      createdByStaffId: currentActor.staffId,
      createdByName: currentActor.name,
      updatedAt: now,
      updatedByUserId: currentActor.userId,
      updatedByStaffId: currentActor.staffId,
      updatedByName: currentActor.name,
      version: 1,
    };
    const result = await saveEquipmentSystem(equipment);
    return { result, equipment: result.ok ? equipment : undefined };
  };

  const attachEquipmentToVisitUnit = async (unit: VisitUnit, equipment: RegisteredEquipmentSystem) => {
    const now = new Date().toISOString();
    const currentActor = actor();
    return saveVisitUnit({
      ...unit,
      equipmentSystemId: equipment.id,
      locationLabel: equipment.locationLabel,
      source: unit.source === 'scheduled' ? 'existing_equipment' : unit.source,
      updatedAt: now,
      updatedByUserId: currentActor.userId,
      updatedByStaffId: currentActor.staffId,
      updatedByName: currentActor.name,
      version: Math.max(1, Number(unit.version ?? 1)) + 1,
    });
  };

  const value = useMemo<TechnicianPortalStateValue>(() => ({
    workVisits,
    visitUnits,
    workInterventions,
    equipmentSystems,
    loading,
    dataError,
    lastSyncedAt,
    refreshTechnicianPortalData: () => refreshTechnicianPortalData(true),
    saveWorkVisit,
    saveVisitUnit,
    saveWorkIntervention,
    saveEquipmentSystem,
    prepareVisitFromWorkOrder,
    addVisitUnit,
    addWorkIntervention,
    registerEquipmentSystem,
    attachEquipmentToVisitUnit,
  }), [workVisits, visitUnits, workInterventions, equipmentSystems, loading, dataError, lastSyncedAt, refreshTechnicianPortalData]);

  return <TechnicianPortalStateContext.Provider value={value}>{children}</TechnicianPortalStateContext.Provider>;
}

export function useTechnicianPortalState() {
  const context = useContext(TechnicianPortalStateContext);
  if (!context) throw new Error('useTechnicianPortalState debe utilizarse dentro de TechnicianPortalStateProvider');
  return context;
}
