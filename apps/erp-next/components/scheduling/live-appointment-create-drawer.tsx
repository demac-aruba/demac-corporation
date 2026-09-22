'use client';

import { ProjectLaborBudgetWarning } from '@/components/projects/project-labor-budget-status';
import { ProjectBudgetConfirmation } from '@/components/projects/project-budget-confirmation';
import { calculateProjectLaborBudget, projectAllocationHours } from '@/lib/project-labor-budget';
import { projectSlotLabel } from '@/lib/project-slot-label';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PropertyLocations } from '../crm/property-locations';
import { PropertyEditor } from '../crm/property-editor';
import type { PropertyEditorValue } from '../../lib/property-editor-draft';
import { emptyPropertyEditor } from '../../lib/property-editor-draft';
import propertyEditorStyles from '../crm/property-editor.module.css';
import type { PropertyLocationData } from '../../lib/property-locations';
import { createAfterHoursEmergency } from '../../lib/after-hours-booking';
import {
  BROWSER_PROJECTS_PREVIEW_KEY,
  commitBrowserProjectsPreviewMutation,
  createProjectsPreviewState,
  linkProjectSchedulingAssignment,
  loadBrowserProjectsPreviewState,
  planProjectScheduling,
  projectIsSchedulable,
  searchProjectsForScheduling,
  type BrowserProject,
  type BrowserProjectsPreviewState,
  type ProjectSchedulingPlan,
} from '../../lib/browser-projects';
import type { AppointmentRecipientSelection } from '../../lib/customer-contacts';
import {
  optionAssignmentCapacityEnd,
  optionAssignmentIsSupport,
  optionAssignmentStart,
  optionAssignmentWorkEnd,
  optionPrimaryAssignment,
  optionSupportWindows,
} from '../../lib/live-appointment-edit-state';
import {
  checkOfficeCreateAvailability,
  confirmOfficeAppointment,
  createOfficeLifecycleRequestId,
  createOfficeTemporaryHold,
  listOfficeBookingPresets,
  officeBookingOutcomeUnknown,
  type OfficeBookingOption,
  type OfficeBookingPreset,
  type OfficeBookingWorkLine,
  type OfficeSupportSlotCandidate,
} from '../../lib/office-booking-authority';
import {
  createBookingCustomerWithProperty,
  createBookingProperty,
  loadBookingContactReferenceData,
  loadBookingMasterReferenceData,
  type BookingCustomer,
  type BookingProperty,
  type BookingReferenceData,
  type NewBookingCustomer,
  type NewBookingProperty,
} from '../../lib/live-scheduling-booking-data';
import {
  liveVanCrew,
  loadLiveOperationalCapacityState,
} from '../../lib/live-operational-capacity';
import { isBackdatedAppointmentTarget } from '../../lib/scheduling-backdating';
import { useAuth } from '../auth/auth-provider';
import { PropertyCommunicationPanel, PropertyContactDraftEditor } from './property-communication-editor';
import styles from './live-appointment-create-drawer.module.css';

export type LiveBookingTarget = {
  dateKey: string;
  vanId: string;
  vanName: string;
  start: string;
  end: string;
};

export type LiveCreatedBooking = {
  appointmentId: string;
  workOrderIds: string[];
  option: OfficeBookingOption;
  customer: BookingCustomer;
  property: BookingProperty;
  preset: OfficeBookingPreset;
  status: 'confirmed' | 'temporary_hold';
  project?: {
    id: string;
    projectNumber: string;
    name: string;
    phaseId: string;
    phaseName: string;
    scheduledHours: number;
    syncStatus: 'linked' | 'pending';
  };
};

export type LiveBookingMode = 'standard' | 'after_hours';

type Props = {
  target: LiveBookingTarget;
  mode?: LiveBookingMode;
  onClose: () => void;
  onCreated: (booking: LiveCreatedBooking) => void;
  onAvailabilityConflict?: () => Promise<void> | void;
};

type CustomerDraft = NewBookingCustomer & {
  preferredLanguage: string;
};

type PropertyDraft = NewBookingProperty & {
  type: string;
  addressDetail: string;
};

type WorkLineDraft = {
  id: string;
  presetId: string;
  quantity: number;
  manualDurationMinutes?: number;
};

type ValidationState = {
  capacitySignature: string;
  offerSignature: string;
  offerId: string;
  offerVersion: number;
  options: OfficeBookingOption[];
  selectedOptionId: string;
};

type ReferenceLoadScope = 'master' | 'contacts' | 'presets';
type AppointmentSource = 'service' | 'project';

const EMPTY_PROJECTS_PREVIEW_STATE: BrowserProjectsPreviewState = {
  version: 1,
  selectedProjectId: '',
  projects: [],
};

const emptyCustomer: CustomerDraft = {
  name: '',
  company: '',
  phone: '',
  whatsapp: '',
  email: '',
  preferredLanguage: 'Papiamento',
};

const emptyProperty: PropertyDraft = {
  name: '',
  type: 'Casa',
  address: '',
  addressDetail: '',
  zone: '',
  neighborhood: '',
  notes: '',
  contactLinks: [],
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function validAfterHoursStart(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 && hour * 60 + minute >= 17 * 60;
}

function referenceLoadError(scope: string, error: unknown) {
  const message = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'The request could not be completed.';
  return `${scope} could not be loaded. ${message}`;
}

function isTransientReferenceLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /took too long|timed out|timeout|failed to fetch|network(?: error)?|load failed|temporarily unavailable/i.test(message);
}

async function withOneTransientRetry<T>(load: () => Promise<T>) {
  try {
    return await load();
  } catch (error) {
    if (!isTransientReferenceLoadError(error)) throw error;
    return load();
  }
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function durationLabel(minutes: number) {
  const hours = Math.max(0, minutes) / 60;
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
  return `${value} hour${hours === 1 ? '' : 's'}`;
}

function customerLabel(customer: BookingCustomer) {
  return text(customer.company) || text(customer.name) || customer.id;
}

function normalizeSearch(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function searchFieldScore(value: unknown, needle: string, priority: number) {
  const candidate = normalizeSearch(value);
  if (!candidate || !needle) return 0;
  if (candidate === needle) return 100 + priority;
  if (candidate.startsWith(needle)) return 85 + priority;
  if (candidate.split(' ').some((part) => part.startsWith(needle))) return 72 + priority;
  if (candidate.includes(needle)) return 55 + priority;
  return 0;
}

function customerSearchScore(customer: BookingCustomer, needle: string, propertySearchValues: string[]) {
  const directScores = [
    searchFieldScore(customer.name, needle, 30),
    searchFieldScore(customer.company, needle, 28),
    searchFieldScore(customer.phone, needle, 25),
    searchFieldScore(customer.whatsapp, needle, 25),
    searchFieldScore(customer.email, needle, 20),
    searchFieldScore(customer.address, needle, 10),
    searchFieldScore(customer.zone, needle, 8),
  ];
  const propertyScore = propertySearchValues.reduce((best, value) => Math.max(best, searchFieldScore(value, needle, 5)), 0);
  return Math.max(propertyScore, ...directScores);
}

function propertyLabel(property: BookingProperty) {
  return text(property.name) || text(property.address) || property.id;
}

function optionMatchesTarget(option: OfficeBookingOption, target: LiveBookingTarget) {
  const primary = optionPrimaryAssignment(option);
  return option.date === target.dateKey
    && option.time === target.start
    && primary?.vanId === target.vanId;
}



function allocationDurationLabel(option: OfficeBookingOption | null, fallbackMinutes: number) {
  if (!option) return fallbackMinutes > 360 ? 'Large job · validate allocation' : fallbackMinutes ? durationLabel(fallbackMinutes) : 'Add work';
  const primary = optionPrimaryAssignment(option);
  if (!primary) return fallbackMinutes ? durationLabel(fallbackMinutes) : 'Validated';
  const primaryLabel = primary.fullDay ? 'Full-day primary van' : durationLabel(primary.durationMinutes || primary.slots * 60);
  return option.assignments.length > 1 ? `${primaryLabel} + support van` : primaryLabel;
}

function isOtherPreset(preset?: OfficeBookingPreset) {
  const value = `${preset?.id ?? ''} ${preset?.label ?? ''}`.toLowerCase();
  return /(^|[^a-z])(other|otro)([^a-z]|$)/.test(value);
}

function newWorkLine(preset: OfficeBookingPreset): WorkLineDraft {
  return {
    id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    presetId: preset.id,
    quantity: 1,
    ...(isOtherPreset(preset) ? { manualDurationMinutes: 60 } : {}),
  };
}

function automaticCustomerDescription(workLines: WorkLineDraft[], presetById: Map<string, OfficeBookingPreset>) {
  const entries = workLines.map((line) => {
    const preset = presetById.get(line.presetId);
    return preset ? `${line.quantity} × ${preset.label}` : '';
  }).filter(Boolean);
  return entries.length ? `Scheduled work: ${entries.join('; ')}.` : '';
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function metadataStringArray(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

function supportCandidatesFromMetadata(metadata: Record<string, unknown> | undefined): OfficeSupportSlotCandidate[] {
  const raw = metadata?.supportSlotCandidates;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    const id = text(item.id);
    const vanId = text(item.vanId);
    const vanName = text(item.vanName) || vanId;
    const time = text(item.time);
    const endTime = text(item.endTime);
    const durationMinutes = Math.max(1, Number(item.durationMinutes) || 60);
    const slots = Math.max(1, Number(item.slots) || 1);
    if (!id || !vanId || !time || !endTime) return null;
    return {
      id,
      vanId,
      vanName,
      time,
      endTime,
      capacityEndTime: text(item.capacityEndTime) || endTime,
      durationMinutes,
      slots,
    } satisfies OfficeSupportSlotCandidate;
  }).filter((item): item is OfficeSupportSlotCandidate => Boolean(item));
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function LiveAppointmentCreateDrawer({ target, mode = 'standard', onClose, onCreated, onAvailabilityConflict }: Props) {
  const { principal } = useAuth();
  const canViewProjects = principal.active && principal.capabilities.has('projects.view');
  const canManageProjects = canViewProjects && principal.capabilities.has('projects.manage');
  const projectAccessRef = useRef({ uid: principal.userId, canView: canViewProjects, canManage: canManageProjects });
  projectAccessRef.current = { uid: principal.userId, canView: canViewProjects, canManage: canManageProjects };
  const isAfterHours = mode === 'after_hours';
  const [references, setReferences] = useState<BookingReferenceData>({ clients: [], properties: [], contacts: [], contactAssignments: [] });
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<ReferenceLoadScope, string>>>({});
  const [crewLabel, setCrewLabel] = useState('Crew loading…');
  const [appointmentSource, setAppointmentSource] = useState<AppointmentSource>('service');
  const [projectsState, setProjectsState] = useState<BrowserProjectsPreviewState>(EMPTY_PROJECTS_PREVIEW_STATE);
  const [projectsReady, setProjectsReady] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projectPhaseId, setProjectPhaseId] = useState('');
  const [projectSlots, setProjectSlots] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [requestedStart, setRequestedStart] = useState(target.start);
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [dwellingId, setDwellingId] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const [accessContactId, setAccessContactId] = useState('');
  const [locationData, setLocationData] = useState<PropertyLocationData | null>(null);
  useEffect(() => { setDwellingId(''); setRequesterId(''); setAccessContactId(''); setLocationData(null); }, [customerId, propertyId]);
  const locationReady = locationData?.property.id === propertyId && (!locationData.property.hasIndependentDwellings || locationData.dwellings.some((item) => item.id === dwellingId));
  const [recipientSelections, setRecipientSelections] = useState<AppointmentRecipientSelection[]>([]);
  const [workLines, setWorkLines] = useState<WorkLineDraft[]>([]);
  const [description, setDescription] = useState('');
  const lastAutoDescriptionRef = useRef('');
  const technicianInstructionsTouchedRef = useRef(false);
  const lastSyncedProjectSiteRef = useRef('');
  const pendingProjectSiteRefreshRef = useRef('');
  const validationEpochRef = useRef(0);
  const offerSignatureRef = useRef('');
  const automaticValidationCapacityRef = useRef('');
  const automaticValidationTimerRef = useRef<number | null>(null);
  const validationChangeKindRef = useRef<'capacity' | 'metadata'>('capacity');
  const validationAbortRef = useRef<AbortController | null>(null);
  const referenceLoadEpochRef = useRef(0);
  const backdatingPromptedRef = useRef(false);
  const [backdatingAcknowledged, setBackdatingAcknowledged] = useState(false);
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [customerEditorOpen, setCustomerEditorOpen] = useState(false);
  const [propertyEditorOpen, setPropertyEditorOpen] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(emptyCustomer);
  const [customerPropertyDraft, setCustomerPropertyDraft] = useState<PropertyDraft>(emptyProperty);
  const [propertyDraft, setPropertyDraft] = useState<PropertyDraft>(emptyProperty);
  const [masterSaving, setMasterSaving] = useState(false);
  const masterInFlight = useRef(false);
  const masterRequestId = useRef('');
  const [masterError, setMasterError] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [holding, setHolding] = useState(false);
  const bookingInFlight = useRef(false);
  const [bookingRecovery, setBookingRecovery] = useState<{ retry: () => Promise<void> } | null>(null);
  const [budgetConfirmation, setBudgetConfirmation] = useState<{ action: 'confirm' | 'hold'; signature: string } | null>(null);
  const [authorityError, setAuthorityError] = useState('');
  const [validated, setValidated] = useState<ValidationState | null>(null);
  const [supportSlotCandidates, setSupportSlotCandidates] = useState<OfficeSupportSlotCandidate[]>([]);
  const [supportMinSlots, setSupportMinSlots] = useState(0);
  const [supportMaxSlots, setSupportMaxSlots] = useState(0);
  const [selectedSupportSlotIds, setSelectedSupportSlotIds] = useState<string[]>([]);
  const loadError = Object.values(loadErrors).filter(Boolean).join(' ');

  const requestTarget = useMemo<LiveBookingTarget>(() => ({
    dateKey: target.dateKey,
    vanId: target.vanId,
    vanName: target.vanName,
    start: requestedStart,
    end: target.end,
  }), [requestedStart, target.dateKey, target.end, target.vanId, target.vanName]);
  const backdatedTarget = useMemo(
    () => !isAfterHours && isBackdatedAppointmentTarget(requestTarget.dateKey, requestTarget.start),
    [isAfterHours, requestTarget.dateKey, requestTarget.start],
  );

  useEffect(() => {
    if (!backdatedTarget) {
      backdatingPromptedRef.current = false;
      setBackdatingAcknowledged(false);
      return;
    }
    if (backdatingPromptedRef.current) return;
    backdatingPromptedRef.current = true;
    const approved = window.confirm([
      'Backdated appointment',
      'This appointment date or start time is in the past. You are recording work after it happened.',
      'Automatic confirmation and reminder messages will not be sent. Are you sure you want to continue?',
    ].join('\n\n'));
    if (!approved) {
      onClose();
      return;
    }
    setBackdatingAcknowledged(true);
  }, [backdatedTarget, onClose]);

  const refreshReferences = useCallback(async () => {
    const referenceLoadEpoch = referenceLoadEpochRef.current + 1;
    referenceLoadEpochRef.current = referenceLoadEpoch;
    setLoadErrors((current) => {
      const next = { ...current };
      delete next.master;
      delete next.contacts;
      return next;
    });
    const [masterResult, contactResult] = await Promise.allSettled([
      loadBookingMasterReferenceData(),
      withOneTransientRetry(loadBookingContactReferenceData),
    ]);
    if (referenceLoadEpoch !== referenceLoadEpochRef.current) return;
    if (masterResult.status === 'fulfilled') {
      setReferences((current) => ({ ...current, ...masterResult.value }));
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.master;
        return next;
      });
    } else {
      setLoadErrors((current) => ({ ...current, master: referenceLoadError('Customer and property data', masterResult.reason) }));
    }
    if (contactResult.status === 'fulfilled') {
      setReferences((current) => ({ ...current, ...contactResult.value }));
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.contacts;
        return next;
      });
    } else {
      setLoadErrors((current) => ({ ...current, contacts: referenceLoadError('Contact directory', contactResult.reason) }));
    }
    if (masterResult.status === 'rejected') throw masterResult.reason;
  }, []);

  useEffect(() => {
    let active = true;
    const referenceLoadEpoch = referenceLoadEpochRef.current + 1;
    referenceLoadEpochRef.current = referenceLoadEpoch;
    setLoading(true);
    setPresetsLoading(true);
    setLoadErrors({});
    const reportError = (scope: ReferenceLoadScope, message: string) => {
      if (!active) return;
      setLoadErrors((current) => ({ ...current, [scope]: message }));
    };

    const masterTask = loadBookingMasterReferenceData()
      .then((masterData) => {
        if (!active || referenceLoadEpoch !== referenceLoadEpochRef.current) return;
        setReferences((current) => ({ ...current, ...masterData }));
        setLoadErrors((current) => {
          const next = { ...current };
          delete next.master;
          return next;
        });
      })
      .catch((error) => {
        if (referenceLoadEpoch === referenceLoadEpochRef.current) {
          reportError('master', referenceLoadError('Customer and property data', error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const contactTask = withOneTransientRetry(loadBookingContactReferenceData)
      .then((contactData) => {
        if (!active || referenceLoadEpoch !== referenceLoadEpochRef.current) return;
        setReferences((current) => ({ ...current, ...contactData }));
        setLoadErrors((current) => {
          const next = { ...current };
          delete next.contacts;
          return next;
        });
      })
      .catch((error) => {
        if (referenceLoadEpoch === referenceLoadEpochRef.current) {
          reportError('contacts', referenceLoadError('Contact directory', error));
        }
      });

    const presetTask = withOneTransientRetry(() => listOfficeBookingPresets())
      .then((presetResult) => {
        if (!active) return;
        setPresets(presetResult.presets.filter((preset) => preset.active !== false));
        setLoadErrors((current) => {
          const next = { ...current };
          delete next.presets;
          return next;
        });
      })
      .catch((error) => reportError('presets', referenceLoadError('Scheduling services', error)))
      .finally(() => {
        if (active) setPresetsLoading(false);
      });

    void Promise.allSettled([masterTask, contactTask, presetTask]);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isAfterHours || !canViewProjects) {
      setProjectsState(EMPTY_PROJECTS_PREVIEW_STATE);
      setProjectsReady(false);
      return undefined;
    }
    const loadProjects = () => {
      setProjectsState(loadBrowserProjectsPreviewState(createProjectsPreviewState()));
      setProjectsReady(true);
    };
    loadProjects();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === BROWSER_PROJECTS_PREVIEW_KEY) loadProjects();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [canViewProjects, isAfterHours]);

  useEffect(() => {
    if (canViewProjects || appointmentSource !== 'project') return;
    validationAbortRef.current?.abort();
    validationAbortRef.current = null;
    validationEpochRef.current += 1;
    setAppointmentSource('service');
    setProjectsState(EMPTY_PROJECTS_PREVIEW_STATE);
    setProjectsReady(false);
    setProjectQuery('');
    setProjectId('');
    setProjectPhaseId('');
    setProjectSlots('');
    setCustomerId('');
    setPropertyId('');
    setRecipientSelections([]);
    setWorkLines([]);
    setDescription('');
    technicianInstructionsTouchedRef.current = false;
    lastSyncedProjectSiteRef.current = '';
    pendingProjectSiteRefreshRef.current = '';
    setTechnicianInstructions('');
    setCustomerEditorOpen(false);
    setPropertyEditorOpen(false);
    setChecking(false);
    setValidated(null);
    setSupportSlotCandidates([]);
    setSupportMinSlots(0);
    setSupportMaxSlots(0);
    setSelectedSupportSlotIds([]);
    setMasterError('');
    setAuthorityError('Projects access is no longer available. Continue with a Regular Booking.');
  }, [appointmentSource, canViewProjects]);

  useEffect(() => () => {
    if (automaticValidationTimerRef.current !== null) {
      window.clearTimeout(automaticValidationTimerRef.current);
      automaticValidationTimerRef.current = null;
    }
    validationAbortRef.current?.abort();
    validationAbortRef.current = null;
    validationEpochRef.current += 1;
  }, []);

  useEffect(() => {
    let active = true;
    setCrewLabel('Crew loading…');
    void loadLiveOperationalCapacityState({ startDate: target.dateKey, endDate: target.dateKey })
      .then((state) => {
        if (active) setCrewLabel(liveVanCrew(state, target.vanId, target.dateKey).label);
      })
      .catch(() => {
        if (active) setCrewLabel('Crew unavailable');
      });
    return () => { active = false; };
  }, [target.dateKey, target.vanId]);

  const projectSourceSelected = !isAfterHours && appointmentSource === 'project';
  const projectMode = projectSourceSelected && canViewProjects;
  const projectWriteBlocked = projectSourceSelected && !canManageProjects;
  const projectAccessRevoked = projectSourceSelected && !canViewProjects;
  const authorizedDescription = projectAccessRevoked ? '' : description;
  const authorizedTechnicianInstructions = projectAccessRevoked ? '' : technicianInstructions;
  const selectedProject = projectMode ? projectsState.projects.find((project) => project.id === projectId) : undefined;
  const selectedProjectRecordId = selectedProject?.id ?? '';
  const selectedProjectCustomerId = selectedProject?.customerId ?? '';
  const selectedProjectSiteId = selectedProject?.siteId ?? '';
  const selectedProjectTechnicianInstructions = selectedProject?.technicianInstructions?.trim() ?? '';
  const schedulableProjectPhases = useMemo(
    () => selectedProject?.phases.filter((phase) => phase.status !== 'Completed') ?? [],
    [selectedProject],
  );
  const selectedProjectPhase = schedulableProjectPhases.find((phase) => phase.id === projectPhaseId);
  const matchingProjects = useMemo(
    () => canViewProjects ? searchProjectsForScheduling(projectsState.projects, projectQuery).slice(0, 10) : [],
    [canViewProjects, projectQuery, projectsState.projects],
  );
  const selectedCustomer = references.clients.find((customer) => customer.id === customerId);
  const customerProperties = useMemo(
    () => references.properties.filter((property) => property.clientId === customerId && property.active !== false),
    [customerId, references.properties],
  );
  const selectedProperty = customerProperties.find((property) => property.id === propertyId);
  const presetById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset])), [presets]);
  const projectWorkPreset = presets.find((preset) => isOtherPreset(preset));
  const selectedPresets = projectMode
    ? (projectWorkPreset ? [projectWorkPreset] : [])
    : workLines.map((line) => presetById.get(line.presetId)).filter((preset): preset is OfficeBookingPreset => Boolean(preset));
  const projectDailySlotLimit = selectedProject?.slotsPerWorkDay ?? 6;
  const projectPlanState = useMemo<{ plan: ProjectSchedulingPlan | null; error: string }>(() => {
    if (!projectMode || !selectedProject || !projectSlots.trim()) return { plan: null, error: '' };
    if (selectedProject.phases.length && !selectedProjectPhase) {
      return { plan: null, error: 'Select an active or planned Project phase.' };
    }
    try {
      return { plan: planProjectScheduling(selectedProject, Number(projectSlots), selectedProjectPhase?.id), error: '' };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : 'Enter a valid whole number of Project slots.' };
    }
  }, [projectMode, projectSlots, selectedProject, selectedProjectPhase]);
  const projectPlan = projectPlanState.plan;
  const projectWorkDescription = selectedProject
    ? `${selectedProject.name} · ${selectedProject.type}${selectedProjectPhase ? ` · ${selectedProjectPhase.name}` : ''}.`
    : '';
  const autoDescription = useMemo(
    () => projectMode ? projectWorkDescription : automaticCustomerDescription(workLines, presetById),
    [presetById, projectMode, projectWorkDescription, workLines],
  );

  useEffect(() => {
    if (!projectMode || !selectedProjectRecordId || technicianInstructionsTouchedRef.current) return;
    setTechnicianInstructions(selectedProjectTechnicianInstructions);
  }, [projectMode, selectedProjectRecordId, selectedProjectTechnicianInstructions]);

  useEffect(() => {
    if (!projectMode || !selectedProjectRecordId || selectedProjectSiteId === lastSyncedProjectSiteRef.current) return;
    const linkedProperty = references.properties.find((property) => property.id === selectedProjectSiteId
      && property.clientId === selectedProjectCustomerId
      && property.active !== false);
    validationAbortRef.current?.abort();
    validationAbortRef.current = null;
    validationEpochRef.current += 1;
    setChecking(false);
    setValidated(null);
    setAuthorityError('');
    setRecipientSelections([]);
    if (selectedProjectSiteId && !linkedProperty) {
      setPropertyId('');
      setMasterError('The Project Service Property changed and is not available in the current CRM references. Refreshing canonical customer data…');
      if (pendingProjectSiteRefreshRef.current !== selectedProjectSiteId) {
        pendingProjectSiteRefreshRef.current = selectedProjectSiteId;
        void refreshReferences().catch(() => {
          if (pendingProjectSiteRefreshRef.current === selectedProjectSiteId) pendingProjectSiteRefreshRef.current = '';
        });
      }
      return;
    }
    lastSyncedProjectSiteRef.current = selectedProjectSiteId;
    pendingProjectSiteRefreshRef.current = '';
    setMasterError('');
    setPropertyId(linkedProperty?.id ?? '');
  }, [projectMode, references.properties, refreshReferences, selectedProjectCustomerId, selectedProjectRecordId, selectedProjectSiteId]);

  useEffect(() => {
    const previousAuto = lastAutoDescriptionRef.current;
    setDescription((current) => {
      const currentTrimmed = current.trim();
      const previousTrimmed = previousAuto.trim();
      if (!currentTrimmed || currentTrimmed === previousTrimmed) return autoDescription;
      if (previousAuto && current.startsWith(previousAuto)) {
        return `${autoDescription}${current.slice(previousAuto.length)}`;
      }
      return current;
    });
    lastAutoDescriptionRef.current = autoDescription;
  }, [autoDescription]);

  const filteredCustomers = useMemo(() => {
    const needle = normalizeSearch(customerQuery);
    if (!needle) return [];

    const propertiesByCustomer = new Map<string, string[]>();
    for (const property of references.properties) {
      const id = text(property.clientId);
      if (!id) continue;
      const current = propertiesByCustomer.get(id) ?? [];
      current.push(`${text(property.name)} ${text(property.address)} ${text(property.zone)} ${text(property.neighborhood)}`);
      propertiesByCustomer.set(id, current);
    }

    for (const contact of references.contacts) {
      const current = propertiesByCustomer.get(contact.clientId) ?? [];
      current.push(`${contact.name} ${contact.phone || ""} ${contact.whatsapp || ""}`);
      propertiesByCustomer.set(contact.clientId, current);
    }
    return references.clients
      .filter((customer) => customer.active !== false)
      .map((customer) => ({
        customer,
        score: customerSearchScore(customer, needle, propertiesByCustomer.get(customer.id) ?? []),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || customerLabel(a.customer).localeCompare(customerLabel(b.customer)))
      .slice(0, 10)
      .map((item) => item.customer);
  }, [customerQuery, references.clients, references.properties, references.contacts]);

  const serviceEstimatedMinutes = workLines.reduce((sum, line) => {
    const preset = presetById.get(line.presetId);
    if (!preset) return sum;
    return sum + (isOtherPreset(preset)
      ? Math.max(60, line.manualDurationMinutes ?? 60)
      : preset.durationMinutesPerUnit * line.quantity);
  }, 0);
  const estimatedMinutes = projectMode ? projectPlan?.scheduledHours ? projectPlan.scheduledHours * 60 : 0 : serviceEstimatedMinutes;
  const totalQuantity = projectMode ? (projectPlan ? 1 : 0) : workLines.reduce((sum, line) => sum + line.quantity, 0);
  const serviceWorkSignature = workLines.map((line) => `${line.presetId}:${line.quantity}:${line.manualDurationMinutes ?? ''}`).join('|');
  const workSignature = projectMode
    ? `project:${projectId}:${projectPhaseId || 'general'}:${projectPlan?.scheduledHours ?? ''}:${projectPlan?.scheduledSlots ?? ''}:${projectPlan?.remainingHoursBefore ?? ''}:${projectWorkPreset?.id ?? ''}`
    : serviceWorkSignature;
  const effectiveRecipientSelections = useMemo(
    () => backdatedTarget
      ? recipientSelections.map((item) => ({ ...item, sendConfirmation: false, sendReminder: false }))
      : recipientSelections,
    [backdatedTarget, recipientSelections],
  );
  const recipientSignature = effectiveRecipientSelections.map((item) => `${item.recipientType}:${item.sourceId}:${Number(item.sendConfirmation)}:${Number(item.sendReminder)}`).sort().join('|');
  const supportSelectionSignature = [...selectedSupportSlotIds].sort().join(',');
  const selectedSupportByVan = useMemo(() => {
    const selectedIds = new Set(selectedSupportSlotIds);
    const grouped = new Map<string, { vanId: string; vanName: string; count: number }>();
    supportSlotCandidates.forEach((candidate) => {
      if (!selectedIds.has(candidate.id)) return;
      const current = grouped.get(candidate.vanId) ?? { vanId: candidate.vanId, vanName: candidate.vanName || candidate.vanId, count: 0 };
      current.count += 1;
      grouped.set(candidate.vanId, current);
    });
    return [...grouped.values()].sort((left, right) => left.vanName.localeCompare(right.vanName));
  }, [selectedSupportSlotIds, supportSlotCandidates]);
  const capacitySignature = [appointmentSource, customerId, propertyId, dwellingId, requesterId, accessContactId, Number(locationReady), workSignature, requestTarget.dateKey, requestTarget.vanId, requestTarget.start, mode, backdatedTarget ? `backdated:${Number(backdatingAcknowledged)}` : 'current'].join('|');
  const offerSignature = [capacitySignature, `support:${supportSelectionSignature}`, recipientSignature, authorizedDescription.trim(), authorizedTechnicianInstructions.trim()].join('|');
  offerSignatureRef.current = offerSignature;
  const capacityValidation = validated?.capacitySignature === capacitySignature ? validated : null;
  const activeValidation = capacityValidation?.offerSignature === offerSignature ? capacityValidation : null;
  const selectedCapacityOption = capacityValidation?.options.find((option) => option.id === capacityValidation.selectedOptionId)
    ?? capacityValidation?.options[0]
    ?? null;
  const selectedValidatedOption = activeValidation?.options.find((option) => option.id === activeValidation.selectedOptionId)
    ?? activeValidation?.options[0]
    ?? null;
  const displayAllocationOption = activeValidation
    ? selectedValidatedOption
    : supportSlotCandidates.length ? null : selectedCapacityOption;
  const allocationBudget = useMemo(() => {
    if (!projectPlan || !selectedProject || !selectedValidatedOption) return { plan: projectPlan, error: '' };
    try {
      const scheduledHours = projectAllocationHours(selectedValidatedOption.assignments);
      const phase = projectPlan.phaseLaborBudget;
      return { plan: { ...projectPlan, scheduledHours, laborBudget: calculateProjectLaborBudget(selectedProject, scheduledHours),
        ...(phase ? { phaseLaborBudget: calculateProjectLaborBudget({ estimatedLaborHours: phase.budgetHours,
          actualLaborHours: phase.recordedActualHours, scheduledFutureHours: phase.scheduledHoursBefore }, scheduledHours) } : {}) }, error: '' };
    } catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'Invalid Van allocation.' }; }
  }, [projectPlan, selectedProject, selectedValidatedOption]);
  const bookingBudgetPlan = allocationBudget.plan;
  const budgetSignature = projectMode && bookingBudgetPlan && activeValidation && selectedValidatedOption
    ? JSON.stringify([principal.userId, projectId, projectPhaseId, bookingBudgetPlan.laborBudget, bookingBudgetPlan.phaseLaborBudget,
      offerSignature, activeValidation.offerId, activeValidation.offerVersion, selectedValidatedOption]) : '';
  const budgetAcknowledgementRequired = Boolean(bookingBudgetPlan && (bookingBudgetPlan.laborBudget.overBudgetHoursAfter > 0
    || (bookingBudgetPlan.phaseLaborBudget?.overBudgetHoursAfter ?? 0) > 0));
  // A selection, offer, actor or forecast change retires the open decision permanently.
  useEffect(() => { setBudgetConfirmation(null); }, [budgetSignature]);
  const workValid = projectMode
    ? Boolean(selectedProject
      && projectWorkPreset
      && projectPlan
      && selectedCustomer?.id === selectedProject.customerId
      && selectedProject.siteId
      && selectedProperty?.id === selectedProject.siteId
      && (!selectedProject.phases.length || selectedProjectPhase))
    : workLines.length > 0 && workLines.every((line) => {
      const preset = presetById.get(line.presetId);
      if (!preset || line.quantity < 1) return false;
      if (!isOtherPreset(preset)) return true;
      const minutes = Number(line.manualDurationMinutes || 0);
      return minutes >= 60 && minutes <= 720 && minutes % 30 === 0;
    });

  const cancelValidationRequest = () => {
    validationAbortRef.current?.abort();
    validationAbortRef.current = null;
  };

  const resetCapacityValidation = () => {
    cancelValidationRequest();
    validationChangeKindRef.current = 'capacity';
    validationEpochRef.current += 1;
    setChecking(false);
    setValidated(null);
    setSupportSlotCandidates([]);
    setSupportMinSlots(0);
    setSupportMaxSlots(0);
    setSelectedSupportSlotIds([]);
    setAuthorityError('');
  };

  const invalidateOfferValidation = () => {
    cancelValidationRequest();
    validationChangeKindRef.current = capacityValidation ? 'metadata' : 'capacity';
    validationEpochRef.current += 1;
    setChecking(false);
    setAuthorityError('');
  };

  const toggleSupportSlot = (slotId: string) => {
    const selected = selectedSupportSlotIds.includes(slotId);
    if (selected && selectedSupportSlotIds.length <= supportMinSlots) return;
    if (!selected && supportMaxSlots > 0 && selectedSupportSlotIds.length >= supportMaxSlots) return;
    cancelValidationRequest();
    validationChangeKindRef.current = 'capacity';
    validationEpochRef.current += 1;
    setChecking(false);
    setAuthorityError('');
    setSelectedSupportSlotIds((current) => selected
      ? current.filter((item) => item !== slotId)
      : [...current, slotId]);
  };

  const projectLinkIssue = (project: BrowserProject) => {
    if (!projectAccessRef.current.canView) return 'Projects viewing permission is required.';
    if (!projectIsSchedulable(project)) return 'This Project is not open for scheduling.';
    const projectCustomer = references.clients.find((customer) => customer.id === project.customerId && customer.active !== false);
    if (!projectCustomer) return 'Needs a canonical CRM Customer link.';
    if (!project.siteId) return 'Needs its canonical Service Property link before scheduling.';
    const projectProperty = references.properties.find((property) => property.id === project.siteId
      && property.clientId === projectCustomer.id
      && property.active !== false);
    return projectProperty ? '' : 'Needs its canonical Service Property link.';
  };

  const chooseAppointmentSource = (source: AppointmentSource) => {
    if (source === 'project' && !projectAccessRef.current.canView) {
      setAuthorityError('Your account does not have permission to view Projects.');
      return;
    }
    if (source === 'project' && backdatedTarget) return;
    if (source === appointmentSource) return;
    setAppointmentSource(source);
    setProjectQuery('');
    setProjectId('');
    setProjectPhaseId('');
    setProjectSlots('');
    setCustomerId('');
    setPropertyId('');
    setRecipientSelections([]);
    setWorkLines([]);
    setDescription('');
    technicianInstructionsTouchedRef.current = false;
    lastSyncedProjectSiteRef.current = '';
    pendingProjectSiteRefreshRef.current = '';
    setTechnicianInstructions('');
    setMasterError('');
    setCustomerEditorOpen(false);
    setPropertyEditorOpen(false);
    resetCapacityValidation();
  };

  const selectProject = (project: BrowserProject) => {
    if (!projectAccessRef.current.canView) {
      setAuthorityError('Your account does not have permission to view Projects.');
      return;
    }
    const linkIssue = projectLinkIssue(project);
    if (linkIssue) {
      setMasterError(`${project.projectNumber}: ${linkIssue}`);
      return;
    }
    const projectCustomer = references.clients.find((customer) => customer.id === project.customerId && customer.active !== false);
    if (!projectCustomer) return;
    const availableProperties = references.properties.filter((property) => property.clientId === projectCustomer.id && property.active !== false);
    const linkedProperty = project.siteId
      ? availableProperties.find((property) => property.id === project.siteId)
      : undefined;
    const defaultPhase = project.phases.find((phase) => phase.status === 'In Progress')
      ?? project.phases.find((phase) => phase.status === 'Planned');
    setProjectId(project.id);
    lastSyncedProjectSiteRef.current = project.siteId;
    pendingProjectSiteRefreshRef.current = '';
    setProjectPhaseId(defaultPhase?.id ?? '');
    setProjectSlots('');
    setCustomerId(projectCustomer.id);
    setPropertyId(linkedProperty?.id ?? (availableProperties.length === 1 ? availableProperties[0].id : ''));
    setRecipientSelections([]);
    setWorkLines([]);
    technicianInstructionsTouchedRef.current = false;
    setTechnicianInstructions(project.technicianInstructions?.trim() ?? '');
    setProjectQuery('');
    setMasterError('');
    setCustomerEditorOpen(false);
    setPropertyEditorOpen(false);
    resetCapacityValidation();
  };

  const selectCustomer = (customer: BookingCustomer) => {
    if (projectMode) return;
    setCustomerId(customer.id);
    const firstProperty = references.properties.find((property) => property.clientId === customer.id && property.active !== false);
    setPropertyId(firstProperty?.id ?? '');
    setRecipientSelections([]);
    setCustomerQuery('');
    setMasterError('');
    setCustomerEditorOpen(false);
    setPropertyEditorOpen(false);
    resetCapacityValidation();
  };

  const addPreset = (preset: OfficeBookingPreset) => {
    setWorkLines((current) => {
      const existing = current.find((line) => line.presetId === preset.id);
      if (!existing) return [...current, newWorkLine(preset)];
      if (isOtherPreset(preset)) return current;
      return current.map((line) => line.id === existing.id ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line);
    });
    resetCapacityValidation();
  };

  const changeQuantity = (lineId: string, delta: number) => {
    setWorkLines((current) => current.map((line) => line.id === lineId
      ? { ...line, quantity: Math.max(1, Math.min(20, line.quantity + delta)) }
      : line));
    resetCapacityValidation();
  };

  const removeWorkLine = (lineId: string) => {
    setWorkLines((current) => current.filter((line) => line.id !== lineId));
    resetCapacityValidation();
  };

  const changeManualHours = (lineId: string, hours: number) => {
    const minutes = Math.max(60, Math.min(720, Math.round(hours * 2) * 30));
    setWorkLines((current) => current.map((line) => line.id === lineId ? { ...line, manualDurationMinutes: minutes } : line));
    resetCapacityValidation();
  };

  const openCustomerEditor = () => {
    masterRequestId.current = createOfficeLifecycleRequestId('schedule-customer');
    setCustomerDraft({ ...emptyCustomer, name: customerQuery.trim() });
    setCustomerPropertyDraft({ ...emptyProperty, contactLinks: [] });
    setMasterError('');
    setCustomerEditorOpen(true);
    setPropertyEditorOpen(false);
  };

  const saveCustomer = async (value: PropertyEditorValue) => {
    if (masterSaving || masterInFlight.current) return;
    masterInFlight.current = true;
    setMasterSaving(true);
    setMasterError('');
    try {
      const created = await createBookingCustomerWithProperty({
        requestId: masterRequestId.current,
        customer: customerDraft,
        property: { ...value, contactLinks: customerPropertyDraft.contactLinks },
        references,
      });
      await refreshReferences().catch(() => undefined);
      setReferences((current) => ({ ...current, clients: [...current.clients.filter((item) => item.id !== created.customer.id), created.customer], properties: [...current.properties.filter((item) => item.id !== created.property.id), created.property] }));
      setCustomerId(created.customer.id);
      setPropertyId(created.property.id);
      setRecipientSelections([]);
      setCustomerQuery('');
      setCustomerEditorOpen(false);
      resetCapacityValidation();
    } catch (error) {
      throw error;
    } finally {
      masterInFlight.current = false;
      setMasterSaving(false);
    }
  };

  const openPropertyEditor = () => {
    masterRequestId.current = createOfficeLifecycleRequestId('schedule-property');
    if (!selectedCustomer) return;
    setPropertyDraft({ ...emptyProperty, zone: text(selectedCustomer.zone), contactLinks: [] });
    setMasterError('');
    setPropertyEditorOpen(true);
    setCustomerEditorOpen(false);
  };

  const saveProperty = async (value: PropertyEditorValue) => {
    if (!selectedCustomer || masterSaving || masterInFlight.current) return;
    masterInFlight.current = true;
    setMasterSaving(true);
    setMasterError('');
    try {
      const created = await createBookingProperty(selectedCustomer.id, { ...value, contactLinks: propertyDraft.contactLinks }, masterRequestId.current);
      await refreshReferences().catch(() => undefined);
      setReferences((current) => ({ ...current, properties: [...current.properties.filter((item) => item.id !== created.id), created] }));
      setPropertyId(created.id);
      setRecipientSelections([]);
      setPropertyEditorOpen(false);
      resetCapacityValidation();
    } catch (error) {
      throw error;
    } finally {
      masterInFlight.current = false;
      setMasterSaving(false);
    }
  };

  const workRequestLines = useCallback((): OfficeBookingWorkLine[] => {
    if (projectMode && selectedProject && projectWorkPreset && projectPlan) {
      const projectInstructions = [
        projectWorkDescription,
        `Planned Project capacity: ${projectPlan.scheduledSlots} slot${projectPlan.scheduledSlots === 1 ? '' : 's'}.`,
        authorizedTechnicianInstructions.trim(),
      ].filter(Boolean).join('\n');
      return [{
        id: `project-${selectedProject.id}-${selectedProjectPhase?.id || 'general'}`,
        presetId: projectWorkPreset.id,
        serviceId: projectWorkPreset.serviceId,
        quantity: 1,
        manualDurationMinutes: projectPlan.scheduledHours * 60,
        customerFacingDescription: authorizedDescription.trim() || projectWorkDescription,
        technicianInstructions: projectInstructions,
      }];
    }
    return workLines.map((line) => {
      const preset = presetById.get(line.presetId)!;
      return {
        id: line.id,
        presetId: preset.id,
        serviceId: preset.serviceId,
        quantity: line.quantity,
        ...(isOtherPreset(preset) ? { manualDurationMinutes: line.manualDurationMinutes } : {}),
      };
    });
  }, [authorizedDescription, authorizedTechnicianInstructions, presetById, projectMode, projectPlan, projectWorkDescription, projectWorkPreset, selectedProject, selectedProjectPhase, workLines]);

  const validateTarget = useCallback(async (automatic = false) => {
    if (!automatic && automaticValidationTimerRef.current !== null) {
      window.clearTimeout(automaticValidationTimerRef.current);
      automaticValidationTimerRef.current = null;
    }
    if (isAfterHours) return;
    if (backdatedTarget && !backdatingAcknowledged) {
      if (!automatic) setAuthorityError('Confirm the backdated appointment warning before validating historical capacity.');
      return;
    }
    if (!selectedCustomer) {
      if (!automatic) setAuthorityError('Select or create a customer first.');
      return;
    }
    if (!selectedProperty) {
      if (!automatic) setAuthorityError('Select or add a service property first.');
      return;
    }
    if (!locationReady) {
      if (!automatic) setAuthorityError('Load the property locations and select a dwelling when required.');
      return;
    }
    if (!workValid) {
      if (!automatic) setAuthorityError(projectMode
        ? projectPlanState.error || 'Select a Project, its phase when applicable, and the whole Project slots to reserve.'
        : 'Add at least one valid work line. Other work requires a manual scheduled duration.');
      return;
    }

    validationAbortRef.current?.abort();
    const requestController = new AbortController();
    validationAbortRef.current = requestController;
    const requestEpoch = validationEpochRef.current + 1;
    validationEpochRef.current = requestEpoch;
    const validationCapacitySignature = capacitySignature;
    const validationOfferSignature = offerSignature;
    setChecking(true);
    setAuthorityError('');
    setValidated((current) => {
      if (current?.capacitySignature !== validationCapacitySignature) return null;
      return current.offerSignature === validationOfferSignature
        ? { ...current, offerSignature: '' }
        : current;
    });
    try {
      const result = await checkOfficeCreateAvailability({
        requestId: createOfficeLifecycleRequestId('schedule-create-check'),
        customerId: selectedCustomer.id,
        propertyId: selectedProperty.id,
        dwellingId, requesterId, accessContactId,
        workLines: workRequestLines(),
        requestedDate: requestTarget.dateKey,
        requestedTime: requestTarget.start,
        requiredVanId: requestTarget.vanId,
        supportSlotSelections: selectedSupportSlotIds,
        customerFacingDescription: authorizedDescription.trim(),
        technicianInstructions: authorizedTechnicianInstructions.trim(),
        recipientSelections: effectiveRecipientSelections,
        notes: `${backdatedTarget ? 'Backdated work recorded' : 'Created'} from LIVE Scheduling slot ${requestTarget.vanId} ${requestTarget.dateKey} ${requestTarget.start}.${projectMode && selectedProject ? ` Project preview link: ${selectedProject.projectNumber} (${selectedProject.id})${selectedProjectPhase ? `, phase ${selectedProjectPhase.name} (${selectedProjectPhase.id})` : ', no phase required'}.` : ''}`,
        ...(backdatedTarget ? { bookingMode: 'backdated' as const, backdatingAcknowledged: true } : {}),
      }, requestController.signal);
      if (requestEpoch !== validationEpochRef.current || offerSignatureRef.current !== validationOfferSignature) return;

      const candidates = supportCandidatesFromMetadata(result.metadata);
      const candidateIds = new Set(candidates.map((candidate) => candidate.id));
      const nextMinSlots = metadataNumber(result.metadata, 'supportMinSlots');
      const nextMaxSlots = metadataNumber(result.metadata, 'supportMaxSlots');
      const serverSelectedIds = metadataStringArray(result.metadata, 'selectedSupportSlotIds').filter((id) => candidateIds.has(id));
      const defaultIds = metadataStringArray(result.metadata, 'defaultSupportSlotIds').filter((id) => candidateIds.has(id));
      const validCurrentSelection = selectedSupportSlotIds.filter((id) => candidateIds.has(id));
      const nextSelection = candidates.length
        ? (validCurrentSelection.length
          ? validCurrentSelection
          : selectedSupportSlotIds.length
            ? validCurrentSelection
            : serverSelectedIds.length ? serverSelectedIds : defaultIds)
        : [];
      setSupportSlotCandidates(candidates);
      setSupportMinSlots(nextMinSlots);
      setSupportMaxSlots(nextMaxSlots);
      if (!sameStringArray(selectedSupportSlotIds, nextSelection)) setSelectedSupportSlotIds(nextSelection);

      const exactOptions = result.options.filter((option) => optionMatchesTarget(option, requestTarget));
      const offer = result.offer;
      if (!result.available || !offer || !exactOptions.length) {
        setValidated(null);
        if (result.reason === 'required-primary-target-unavailable') {
          setAuthorityError(`${requestTarget.vanName} no longer has the complete requested capacity at ${formatTime(requestTarget.start)}. Another appointment or Temporary Hold may already reserve one or more of these slots. The live agenda is being refreshed; choose another open Van/day or review the existing reservation. Nothing was changed.`);
          void onAvailabilityConflict?.();
        } else if (result.reason === 'support-selection-count') {
          setAuthorityError(`Select between ${nextMinSlots} and ${nextMaxSlots} available support spots before confirming this large job.`);
        } else if (result.reason === 'support-selection-unavailable') {
          setAuthorityError('One or more selected support spots are no longer available. Review the live support slots and choose another open spot. Nothing was changed.');
        } else {
          const reason = result.reason ? ` (${result.reason})` : '';
          setAuthorityError(`Booking Authority could not reserve the complete allocation for this van/time${reason}. The schedule was not changed.`);
        }
        return;
      }
      setValidated((current) => ({
        capacitySignature: validationCapacitySignature,
        offerSignature: validationOfferSignature,
        offerId: offer.id,
        offerVersion: offer.version,
        options: exactOptions,
        selectedOptionId: current?.capacitySignature === validationCapacitySignature
          && exactOptions.some((option) => option.id === current.selectedOptionId)
          ? current.selectedOptionId
          : exactOptions[0].id,
      }));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (requestEpoch === validationEpochRef.current && offerSignatureRef.current === validationOfferSignature) {
        setAuthorityError(error instanceof Error ? error.message : 'Booking Authority could not validate this target.');
      }
    } finally {
      if (validationAbortRef.current === requestController) validationAbortRef.current = null;
      if (requestEpoch === validationEpochRef.current) setChecking(false);
    }
  }, [dwellingId, requesterId, accessContactId, locationReady, authorizedDescription, authorizedTechnicianInstructions, backdatedTarget, backdatingAcknowledged, capacitySignature, effectiveRecipientSelections, isAfterHours, offerSignature, onAvailabilityConflict, projectMode, projectPlanState.error, requestTarget, selectedCustomer, selectedProject, selectedProjectPhase, selectedProperty, selectedSupportSlotIds, workRequestLines, workValid]);

  useEffect(() => {
    const capacityChanged = automaticValidationCapacityRef.current !== capacitySignature;
    automaticValidationCapacityRef.current = capacitySignature;
    if (capacityChanged) validationChangeKindRef.current = 'capacity';
    if (bookingRecovery || isAfterHours || (backdatedTarget && !backdatingAcknowledged) || loading || masterSaving || saving || holding || !selectedCustomer || !selectedProperty || !workValid) return;
    const timer = window.setTimeout(() => {
      if (automaticValidationTimerRef.current === timer) automaticValidationTimerRef.current = null;
      validationChangeKindRef.current = 'metadata';
      void validateTarget(true);
    }, validationChangeKindRef.current === 'capacity' ? 100 : 800);
    automaticValidationTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (automaticValidationTimerRef.current === timer) automaticValidationTimerRef.current = null;
    };
  }, [bookingRecovery, backdatedTarget, backdatingAcknowledged, capacitySignature, holding, isAfterHours, loading, masterSaving, offerSignature, saving, selectedCustomer, selectedProperty, validateTarget, workValid]);

  const saveProjectBookingLink = async (input: {
    appointmentId: string;
    workOrderIds: string[];
    option: OfficeBookingOption;
    status: 'confirmed' | 'temporary_hold';
  }) => {
    if (!projectMode) return true;
    if (!projectAccessRef.current.canManage || projectAccessRef.current.uid !== principal.userId || !selectedProject || !projectPlan) return false;
    try {
      const nextState = await commitBrowserProjectsPreviewMutation(projectsState, (latestProjectsState) => {
        const latestProject = latestProjectsState.projects.find((project) => project.id === selectedProject.id);
        if (!latestProject
          || latestProject.customerId !== selectedCustomer?.id
          || latestProject.siteId !== selectedProperty?.id) {
          throw new Error('The latest Project customer or Service Property no longer matches this appointment.');
        }
        if (input.workOrderIds.length !== input.option.assignments.length
          || new Set(input.workOrderIds).size !== input.workOrderIds.length) throw new Error('Canonical Work Order allocation is incomplete.');
        // Booking Authority builds Work Orders in option.assignments order. Each
        // primary/support Work Order is linked once using its existing stable ID.
        const linkedAllocations = new Set<string>();
        return input.option.assignments.reduce((state, allocation, index) => {
          const key = JSON.stringify([allocation.vanId, allocation.time ?? '']);
          if (linkedAllocations.has(key)) return state;
          linkedAllocations.add(key);
          return linkProjectSchedulingAssignment(state, {
            projectId: selectedProject.id,
            customerId: selectedCustomer.id,
            siteId: selectedProperty.id,
            phaseId: selectedProjectPhase?.id ?? '',
            appointmentId: input.appointmentId,
            workOrderId: input.workOrderIds[index],
            bookingStatus: input.status,
            vanId: allocation.vanId,
            technicianIds: allocation.technicianIds,
            scheduledSlots: projectAllocationHours([allocation]) * 60 / latestProject.slotDurationMinutes,
            scheduledDate: input.option.date,
            scheduledStart: optionAssignmentStart(input.option, allocation),
            scheduledEnd: optionAssignmentCapacityEnd(input.option, allocation),
          });
        }, latestProjectsState);
      }, {
        authorize: () => {
          if (!projectAccessRef.current.canManage || projectAccessRef.current.uid !== principal.userId) {
            throw new Error('Projects management permission changed before the Scheduling link was saved.');
          }
        },
      });
      setProjectsState(nextState);
      return true;
    } catch {
      return false;
    }
  };

  const createdProjectContext = selectedProject && projectPlan ? {
    id: selectedProject.id,
    projectNumber: selectedProject.projectNumber,
    name: selectedProject.name,
    phaseId: selectedProjectPhase?.id ?? '',
    phaseName: selectedProjectPhase?.name ?? selectedProject.type,
    scheduledHours: bookingBudgetPlan?.scheduledHours ?? projectPlan.scheduledHours,
  } : undefined;

  const confirmBooking = async (acknowledgedBudget?: string) => {
    const projectBookingRequested = !isAfterHours && appointmentSource === 'project';
    if (projectBookingRequested && (!projectAccessRef.current.canManage || projectAccessRef.current.uid !== principal.userId)) {
      setAuthorityError('Projects management permission is required to confirm an appointment linked to a Project.');
      return;
    }
    if (!locationReady || !selectedCustomer || !selectedProperty || !selectedPresets.length || !workValid || saving || holding || bookingInFlight.current) return;
    if (backdatedTarget && !backdatingAcknowledged) {
      setAuthorityError('Confirm the backdated appointment warning before saving this historical appointment.');
      return;
    }
    if (isAfterHours) {
      if (!validAfterHoursStart(requestTarget.start)) {
        setAuthorityError('After-hours work must start at 5:00 PM or later.');
        return;
      }
      setSaving(true);
      setAuthorityError('');
      try {
        const result = await createAfterHoursEmergency({
          requestId: createOfficeLifecycleRequestId('after-hours-emergency'),
          customerId: selectedCustomer.id,
          propertyId: selectedProperty.id,
          dwellingId, requesterId, accessContactId,
          workLines: workRequestLines(),
          requestedDate: requestTarget.dateKey,
          requestedTime: requestTarget.start,
          requiredVanId: requestTarget.vanId,
          customerFacingDescription: authorizedDescription.trim(),
          technicianInstructions: authorizedTechnicianInstructions.trim(),
          recipientSelections,
        });
        onCreated({
          appointmentId: result.appointmentId,
          workOrderIds: result.workOrderIds,
          option: {
            id: `after-hours:${result.appointmentId}`,
            date: requestTarget.dateKey,
            time: requestTarget.start,
            assignments: [{
              vanId: requestTarget.vanId,
              vanName: requestTarget.vanName,
              quantity: totalQuantity,
              slots: 0,
              time: requestTarget.start,
              role: 'primary',
            }],
          },
          customer: selectedCustomer,
          property: selectedProperty,
          preset: selectedPresets[0],
          status: 'confirmed',
        });
      } catch (error) {
        setAuthorityError(error instanceof Error ? error.message : 'The after-hours job could not be created.');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!activeValidation || !selectedValidatedOption) return;
    if (projectBookingRequested && !bookingBudgetPlan) { setAuthorityError(allocationBudget.error); return; }
    if (budgetAcknowledgementRequired && acknowledgedBudget !== budgetSignature) {
      setBudgetConfirmation({ action: 'confirm', signature: budgetSignature });
      return;
    }
    setBudgetConfirmation(null);
    bookingInFlight.current = true;
    setSaving(true);
    setAuthorityError('');
    const { offerId, offerVersion } = activeValidation;
    const option = selectedValidatedOption;
    try {
      const result = await confirmOfficeAppointment({
        requestId: `schedule-create:${offerId}:${offerVersion}:${option.id}`,
        offerId,
        offerVersion,
        optionId: option.id,
        ...(backdatedTarget ? { bookingMode: 'backdated' as const, backdatingAcknowledged: true } : {}),
      });
      setBookingRecovery(null);
      const projectLinked = projectBookingRequested && projectAccessRef.current.canManage
        ? await saveProjectBookingLink({
          appointmentId: result.appointmentId,
          workOrderIds: result.workOrderIds ?? [],
          option,
          status: 'confirmed',
        })
        : !projectBookingRequested;
      const canExposeCreatedProject = projectAccessRef.current.canView;
      onCreated({
        appointmentId: result.appointmentId,
        workOrderIds: result.workOrderIds ?? [],
        option,
        customer: selectedCustomer,
        property: selectedProperty,
        preset: selectedPresets[0],
        status: 'confirmed',
        ...(createdProjectContext && canExposeCreatedProject ? { project: { ...createdProjectContext, syncStatus: projectLinked ? 'linked' as const : 'pending' as const } } : {}),
      });
    } catch (error) {
      if (projectBookingRequested && officeBookingOutcomeUnknown(error)) {
        // Keep the original offer, option, acknowledgement and request ID, even if a
        // storage update changes the current forecast while this response is lost.
        setBookingRecovery({ retry: () => confirmBooking(acknowledgedBudget) });
      } else {
        setBookingRecovery(null);
        setValidated(null);
      }
      setAuthorityError(error instanceof Error ? error.message : 'The appointment could not be confirmed.');
    } finally {
      bookingInFlight.current = false;
      setSaving(false);
    }
  };

  const holdBooking = async (acknowledgedBudget?: string) => {
    const projectBookingRequested = !isAfterHours && appointmentSource === 'project';
    if (projectBookingRequested && (!projectAccessRef.current.canManage || projectAccessRef.current.uid !== principal.userId)) {
      setAuthorityError('Projects management permission is required to place a Temporary Hold linked to a Project.');
      return;
    }
    if (!activeValidation || !selectedValidatedOption || !selectedCustomer || !selectedProperty || !selectedPresets.length || saving || holding || bookingInFlight.current) return;
    if (projectBookingRequested && !bookingBudgetPlan) { setAuthorityError(allocationBudget.error); return; }
    if (budgetAcknowledgementRequired && acknowledgedBudget !== budgetSignature) {
      setBudgetConfirmation({ action: 'hold', signature: budgetSignature });
      return;
    }
    setBudgetConfirmation(null);
    bookingInFlight.current = true;
    setHolding(true);
    setAuthorityError('');
    const { offerId, offerVersion } = activeValidation;
    const option = selectedValidatedOption;
    try {
      const result = await createOfficeTemporaryHold({
        requestId: `schedule-hold:${offerId}:${offerVersion}:${option.id}`,
        offerId,
        offerVersion,
        optionId: option.id,
      });
      setBookingRecovery(null);
      const projectLinked = projectBookingRequested && projectAccessRef.current.canManage
        ? await saveProjectBookingLink({
          appointmentId: result.appointmentId,
          workOrderIds: result.workOrderIds ?? [],
          option,
          status: 'temporary_hold',
        })
        : !projectBookingRequested;
      const canExposeCreatedProject = projectAccessRef.current.canView;
      onCreated({
        appointmentId: result.appointmentId,
        workOrderIds: result.workOrderIds ?? [],
        option,
        customer: selectedCustomer,
        property: selectedProperty,
        preset: selectedPresets[0],
        status: 'temporary_hold',
        ...(createdProjectContext && canExposeCreatedProject ? { project: { ...createdProjectContext, syncStatus: projectLinked ? 'linked' as const : 'pending' as const } } : {}),
      });
    } catch (error) {
      if (projectBookingRequested && officeBookingOutcomeUnknown(error)) {
        setBookingRecovery({ retry: () => holdBooking(acknowledgedBudget) });
      } else {
        setBookingRecovery(null);
        setValidated(null);
      }
      setAuthorityError(error instanceof Error ? error.message : 'The temporary hold could not be created.');
    } finally {
      bookingInFlight.current = false;
      setHolding(false);
    }
  };

  const busy = loading || masterSaving || saving || holding;

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !bookingRecovery) onClose(); }}>
      {budgetConfirmation && budgetConfirmation.signature === budgetSignature && bookingBudgetPlan && canManageProjects && !busy && !checking && <ProjectBudgetConfirmation
        key={budgetConfirmation.signature}
        slotDurationMinutes={selectedProject?.slotDurationMinutes ?? 60}
        budgets={[{ scope: 'Proyecto', budget: bookingBudgetPlan.laborBudget }, ...(bookingBudgetPlan.phaseLaborBudget ? [{ scope: 'Fase', budget: bookingBudgetPlan.phaseLaborBudget }] : [])]}
        onCancel={() => setBudgetConfirmation(null)}
        onContinue={() => { void (budgetConfirmation.action === 'hold' ? holdBooking(budgetConfirmation.signature) : confirmBooking(budgetConfirmation.signature)); }}
      />}
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={isAfterHours ? `Create after-hours appointment for ${requestTarget.vanName}` : 'Create appointment'}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Booking Authority · {isAfterHours ? 'After-Hours / Emergency' : 'Canonical Scheduling'}</span>
            <h2>{isAfterHours ? 'New after-hours appointment' : 'New appointment'}</h2>
            <p>{isAfterHours
              ? 'Use the same canonical customer, property, contacts and work-selection flow as every appointment. The selected Van receives one extra open-ended job from 5:00 PM onward.'
              : canViewProjects
                ? 'Create a Regular Booking or select an existing Project. Customer, property, work and Van time are validated together before anything is committed.'
                : 'Create a Regular Booking. Customer, property, work and Van time are validated together before anything is committed.'}</p>
          </div>
          <button type="button" className={styles.close} disabled={busy || Boolean(bookingRecovery)} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.body} inert={saving || holding || Boolean(bookingRecovery)}>
          <section className={styles.targetCard}>
            <div><span>DATE</span><strong>{formatDate(requestTarget.dateKey)}</strong></div>
            <div><span>PRIMARY VAN</span><strong>{requestTarget.vanName} · {crewLabel}</strong></div>
            {isAfterHours ? (
              <div><label htmlFor="after-hours-start" style={{ display: 'block', color: 'var(--brand)', fontSize: '5.5px', fontWeight: 950, letterSpacing: '.07em' }}>START · 5:00 PM OR LATER</label><input id="after-hours-start" style={{ width: '100%', boxSizing: 'border-box', marginTop: 3, border: '1px solid var(--border)', borderRadius: 7, padding: '5px 7px', color: 'var(--text)', background: 'var(--surface)' }} type="time" min="17:00" value={requestedStart} onChange={(event) => { setRequestedStart(event.target.value); resetCapacityValidation(); }} /></div>
            ) : <div><span>START</span><strong>{formatTime(requestTarget.start)}</strong></div>}
            <div><span>{isAfterHours ? 'WORK RULE' : 'OPEN BLOCK'}</span><strong>{isAfterHours ? 'Extra job · open-ended until field completion' : `${formatTime(requestTarget.start)}–${formatTime(requestTarget.end)}`}</strong></div>
          </section>

          {loadError ? <div className={styles.errorBox} role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><span>{loadError}</span><button type="button" className={styles.secondaryButton} onClick={() => { pendingProjectSiteRefreshRef.current = ''; void refreshReferences().catch(() => undefined); }}>Retry customer data</button></div> : null}
          {authorityError ? <div className={styles.errorBox} role="alert">{authorityError}</div> : null}
          {masterError ? <div className={styles.errorBox} role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><span>{masterError}</span>{projectMode ? <button type="button" className={styles.secondaryButton} onClick={() => { pendingProjectSiteRefreshRef.current = ''; void refreshReferences().catch(() => undefined); }}>Retry Project property</button> : null}</div> : null}
          {backdatedTarget && backdatingAcknowledged ? <div className={styles.authorityIdle} style={{ marginBottom: 10, border: '1px solid var(--warning, #f59e0b)', borderRadius: 10, background: 'var(--surface)' }} role="status"><strong style={{ display: 'block', marginBottom: 3, color: 'var(--warning, #b45309)' }}>BACKDATED APPOINTMENT</strong><span>This records work after it happened. Historical Van capacity will still be checked, and no automatic confirmation or reminder will be sent.</span></div> : null}

          {!isAfterHours ? (
            <section className={styles.section}>
              <header><div><span>1</span><strong>Appointment source</strong><small>{canViewProjects ? 'Create a Regular Booking or reserve real Scheduling capacity for an existing Project.' : 'Create a Regular Booking from canonical customer, property, and Services & Products records.'}</small></div></header>
              <div className={styles.sectionBody}>
                <div className={styles.sourceToggle}>
                  <button type="button" className={`${styles.sourceOption} ${!projectMode ? styles.sourceOptionActive : ''}`} aria-pressed={!projectMode} onClick={() => chooseAppointmentSource('service')}>
                    <strong>Regular Booking</strong><span>Choose customer, property and work from Services & Products.</span>
                  </button>
                  {canViewProjects ? <button type="button" disabled={backdatedTarget} className={`${styles.sourceOption} ${projectMode ? styles.sourceOptionActive : ''}`} aria-pressed={projectMode} onClick={() => chooseAppointmentSource('project')}>
                    <strong>Project</strong><span>Find a Project and reserve whole Van capacity slots against it.</span>
                  </button> : null}
                </div>
                {projectMode ? (
                  <div className={styles.projectPicker}>
                    <label className={styles.fieldWide}>
                      <span>Search Project</span>
                      <input autoFocus value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Project name, number, customer or location…" />
                    </label>
                    <div className={styles.searchResults}>
                      {matchingProjects.map((project) => {
                        const linkIssue = projectLinkIssue(project);
                        const selected = project.id === projectId;
                        return (
                          <button type="button" key={project.id} disabled={Boolean(linkIssue)} className={`${styles.searchResult} ${selected ? styles.selectedResult : ''}`} aria-pressed={selected} onClick={() => selectProject(project)}>
                            <div><strong>{project.projectNumber} · {project.name}</strong><span>{project.customerName} · {project.type}</span></div>
                            <small>{linkIssue || `${project.location || 'Location pending'} · ${project.status}`}</small>
                            <b>{selected ? 'SELECTED' : linkIssue ? 'LINK NEEDED' : 'SELECT'}</b>
                          </button>
                        );
                      })}
                      {projectsReady && !matchingProjects.length ? <div className={styles.emptyResult}>No schedulable Project matches this search.</div> : null}
                    </div>
                    {selectedProject ? (
                      <div className={styles.linkedProject}>
                        <div><span>SELECTED PROJECT</span><strong>{selectedProject.projectNumber} · {selectedProject.name}</strong><small>{selectedProject.customerName} · {selectedProject.location || 'Property to be selected'}</small></div>
                        <button type="button" onClick={() => { setProjectId(''); setProjectPhaseId(''); setProjectSlots(''); setCustomerId(''); setPropertyId(''); setRecipientSelections([]); technicianInstructionsTouchedRef.current = false; lastSyncedProjectSiteRef.current = ''; pendingProjectSiteRefreshRef.current = ''; setTechnicianInstructions(''); resetCapacityValidation(); }}>Change</button>
                      </div>
                    ) : null}
                    <div className={styles.previewBoundary} role="note"><strong>{canManageProjects ? 'Preview bridge:' : 'Read-only Project access:'}</strong> {canManageProjects ? 'the Appointment and its capacity locks are canonical. The selected Project is linked to the generated Work Order. A Temporary Hold blocks the same slots without sending customer confirmation or reminders until it is manually confirmed.' : 'you may inspect and plan against this Project, but confirming or holding a linked appointment requires Projects management permission.'}</div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className={styles.section}>
            <header><div><span>{isAfterHours ? '1' : '2'}</span><strong>Customer</strong><small>{projectMode ? 'The selected Project supplies its canonical CRM customer.' : 'Search canonical CRM records or register a new customer.'}</small></div></header>
            <div className={styles.sectionBody}>
              {projectMode ? (
                selectedCustomer ? <div className={styles.lockedIdentity}><span>LINKED FROM PROJECT</span><strong>{customerLabel(selectedCustomer)}</strong><small>{text(selectedCustomer.phone) || text(selectedCustomer.whatsapp) || 'No phone'} · Customer cannot be changed while this Project is selected.</small></div>
                  : <div className={styles.emptyResult}>Select a Project that is linked to a canonical CRM customer.</div>
              ) : <>
              <label className={styles.fieldWide}>
                <span>Search customer</span>
                <input autoFocus={!loading} value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Name, company, phone, WhatsApp, address or area…" />
              </label>
              {customerQuery.trim() ? (
                <div className={styles.searchResults}>
                  {filteredCustomers.map((customer) => (
                    <button type="button" key={customer.id} className={`${styles.searchResult} ${customer.id === customerId ? styles.selectedResult : ''}`} onClick={() => selectCustomer(customer)}>
                      <div><strong>{customerLabel(customer)}</strong><span>{text(customer.name) && text(customer.company) ? `${customer.name} · ` : ''}{text(customer.phone) || text(customer.whatsapp) || 'No phone'}</span></div>
                      <small>{text(customer.zone) || 'Area not specified'}</small>
                      <b>{customer.id === customerId ? 'SELECTED' : 'SELECT'}</b>
                    </button>
                  ))}
                  {!filteredCustomers.length && !loading && !loadErrors.master ? <div className={styles.emptyResult}>No existing customer matches this search.</div> : null}
                </div>
              ) : null}
              <button type="button" className={styles.inlineAction} onClick={openCustomerEditor}>＋ Create customer</button>

              </>}
            </div>
          </section>

          <section className={styles.section}>
            <header><div><span>{isAfterHours ? '2' : '3'}</span><strong>Service property</strong><small>{projectMode && selectedProject?.siteId ? 'The selected Project supplies its canonical Service Property.' : 'Appointments always point to a real property belonging to the selected customer.'}</small></div></header>
            <div className={styles.sectionBody}>
              {selectedCustomer ? (
                <>
                  <div className={styles.choiceGrid}>
                    {customerProperties.map((property) => (
                      <button type="button" key={property.id} disabled={Boolean(projectMode && (!selectedProject?.siteId || property.id !== selectedProject.siteId))} aria-pressed={property.id === propertyId} className={`${styles.choice} ${property.id === propertyId ? styles.choiceSelected : ''}`} onClick={() => { setPropertyId(property.id); setRecipientSelections([]); resetCapacityValidation(); }}>
                        <strong>{propertyLabel(property)}</strong><span>{text(property.address) || 'No address'}</span><small>{text(property.operationalZone) || text(property.zone) || 'Area not specified'}</small>
                      </button>
                    ))}
                  </div>
                  {!customerProperties.length ? <div className={styles.emptyResult}>This customer has no active service property yet.</div> : null}
                  {projectMode && selectedProject && !selectedProject.siteId ? <div className={styles.previewBoundary}><strong>Project update required:</strong> this Project has no linked Service Property. Open the Project, use Edit Project to link its canonical property, then return to Scheduling.</div> : null}
                  {!projectMode ? <button type="button" className={styles.inlineAction} onClick={openPropertyEditor}>＋ Add property</button> : null}
                  {selectedProperty ? <>
                    <PropertyLocations key={`${customerId}:${propertyId}`} customerId={customerId} propertyId={propertyId} contacts={references.contacts} customerName={customerLabel(selectedCustomer)} booking selectedId={dwellingId}
                      onSelect={(id) => { setDwellingId(id); setAccessContactId(''); setRecipientSelections([]); resetCapacityValidation(); }}
                      onLoaded={(data) => { setLocationData(data); if (data) setReferences((current) => ({ ...current, properties: current.properties.map((item) => item.id === data.property.id ? { ...item, ...data.property } : item), contactAssignments: [...current.contactAssignments.filter((item) => item.propertyId !== data.property.id), ...data.assignments] })); }} />
                    <div className={styles.formGrid}>
                      <label><span>Requested by · this visit</span><select value={requesterId} onChange={(event) => { setRequesterId(event.target.value); invalidateOfferValidation(); }}><option value="">Pending / not recorded</option><option value={`client:${customerId}`}>{customerLabel(selectedCustomer)} · owner</option>{references.contacts.filter((contact) => contact.clientId === customerId).map((contact) => <option key={contact.id} value={`contact:${contact.id}`}>{contact.name}</option>)}</select></label>
                      <label><span>Access contact · this visit</span><select value={accessContactId} onChange={(event) => { setAccessContactId(event.target.value); invalidateOfferValidation(); }}><option value="">Pending / not recorded</option><option value={`client:${customerId}`}>{customerLabel(selectedCustomer)} · owner</option>{references.contacts.filter((contact) => contact.clientId === customerId).map((contact) => <option key={contact.id} value={`contact:${contact.id}`}>{contact.name}{locationData?.assignments.some((item) => item.contactId === contact.id && item.dwellingId === dwellingId) ? ' · dwelling contact' : ''}</option>)}</select></label>
                    </div><p>These choices apply only to this visit. Ownership, dwelling contacts and billing responsibility remain separate.</p>
                  </> : null}
                  {selectedProperty && !backdatedTarget ? <PropertyCommunicationPanel
                    client={selectedCustomer}
                    propertyId={selectedProperty.id}
                    dwellingId={dwellingId}
                    contacts={references.contacts}
                    assignments={references.contactAssignments}
                    selections={recipientSelections}
                    onSelectionsChange={(next) => { setRecipientSelections(next); invalidateOfferValidation(); }}
                    onRefresh={refreshReferences}
                  /> : selectedProperty ? <div className={styles.authorityIdle} style={{ marginTop: 10, border: '1px solid var(--warning, #f59e0b)', borderRadius: 10 }}><strong style={{ display: 'block', color: 'var(--warning, #b45309)' }}>Customer messages are off for this backdated appointment.</strong><span>Confirmation and reminder choices are intentionally suppressed because the work already happened.</span></div> : null}
                </>
              ) : <div className={styles.emptyResult}>Select a customer to load their properties.</div>}

            </div>
          </section>

          <section className={styles.section}>
            <header><div><span>{isAfterHours ? '3' : '4'}</span><strong>Work & allocation</strong><small>{projectMode ? 'Choose the Project slots to reserve in the crew schedule.' : 'Quick booking services come from Services & Products. Click a tile to add work; click it again to increase quantity.'}</small></div></header>
            <div className={styles.sectionBody}>
              {projectMode ? (
                selectedProject ? (
                  <div className={styles.projectWorkPanel}>
                    <div className={styles.projectWorkHeading}>
                      <div><span>PROJECT WORK</span><strong>{selectedProject.projectNumber} · {selectedProject.name}</strong><small>{selectedProject.type} · {selectedProject.customerName}</small></div>
                      <b>{selectedProject.status}</b>
                    </div>
                    <div className={styles.formGrid}>
                      {selectedProject.phases.length ? (
                        <label>
                          <span>Project phase *</span>
                          <select value={projectPhaseId} onChange={(event) => { setProjectPhaseId(event.target.value); resetCapacityValidation(); }}>
                            <option value="">Select phase</option>
                            {schedulableProjectPhases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name} · {phase.status}</option>)}
                          </select>
                        </label>
                      ) : <div className={styles.lockedIdentity}><span>PROJECT TYPE</span><strong>{selectedProject.type}</strong><small>This Project does not require a separate phase.</small></div>}
                      <label>
                        <span>Planned Project slots *</span>
                        <input aria-invalid={Boolean(projectPlanState.error)} aria-describedby="project-slots-help" type="number" min="1" max={projectDailySlotLimit} step="1" inputMode="numeric" value={projectSlots} onChange={(event) => { setProjectSlots(event.target.value); resetCapacityValidation(); }} placeholder={`1–${projectDailySlotLimit} slots`} />
                      </label>
                      <div id="project-slots-help" className={`${styles.previewBoundary} ${styles.fieldWide}`}><strong>Project capacity:</strong> select whole slots from the crew schedule. {projectDailySlotLimit === 6 ? 'A normal workday has 6 slots: 3 in the morning and 3 in the afternoon.' : `This Project allows up to ${projectDailySlotLimit} slots per workday.`} Actual availability is checked before booking.</div>
                    </div>
                    {projectPlanState.error ? <div className={styles.projectPlanError} role="alert">{projectPlanState.error}</div> : null}
                    {bookingBudgetPlan ? <ProjectLaborBudgetWarning budget={bookingBudgetPlan.laborBudget} slotDurationMinutes={selectedProject.slotDurationMinutes} /> : null}
                    {bookingBudgetPlan?.phaseLaborBudget ? <ProjectLaborBudgetWarning budget={bookingBudgetPlan.phaseLaborBudget} slotDurationMinutes={selectedProject.slotDurationMinutes} scope="Phase" /> : null}
                    {projectPlan ? (
                      <div className={styles.projectPlanSummary}>
                        <div><span>SELECTED SLOTS</span><strong>{projectPlan.scheduledSlots} {projectPlan.scheduledSlots === 1 ? 'slot' : 'slots'}</strong></div>
                        <div><span>PROJECT SLOT BUDGET</span><strong>{projectSlotLabel(projectPlan.laborBudget.budgetHours, selectedProject.slotDurationMinutes)}</strong></div>
                        <div><span>BUDGET SLOTS REMAINING</span><strong>{projectSlotLabel((bookingBudgetPlan ?? projectPlan).laborBudget.remainingHoursAfter, selectedProject.slotDurationMinutes)}</strong><small>{projectSlotLabel(projectPlan.remainingHoursBefore, selectedProject.slotDurationMinutes)} before this visit</small></div>
                      </div>
                    ) : null}
                    {!projectWorkPreset && !presetsLoading ? <div className={styles.projectPlanError} role="alert">Scheduling needs the active “Other” work type to reserve Project slots. Enable it in Services & Products.</div> : null}
                  </div>
                ) : <div className={styles.emptyResult}>Select a Project above before entering planned slots.</div>
              ) : <>
              <div className={styles.presetGrid}>
                {presets.map((preset) => {
                  const selectedLine = workLines.find((line) => line.presetId === preset.id);
                  return (
                    <button type="button" key={preset.id} className={`${styles.preset} ${selectedLine ? styles.presetSelected : ''}`} onClick={() => addPreset(preset)}>
                      <strong>{preset.label}</strong>
                      <span>{isOtherPreset(preset) ? 'Manual scheduled time' : `${durationLabel(preset.durationMinutesPerUnit)} / unit`}{selectedLine ? ` · selected × ${selectedLine.quantity}` : ''}</span>
                    </button>
                  );
                })}
              </div>
              {!presets.length && !presetsLoading && !loadErrors.presets ? <div className={styles.emptyResult}>No services are marked “Show in Scheduling” yet. Configure the quick booking list in Services & Products.</div> : null}

              {workLines.length ? (
                <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
                  {workLines.map((line) => {
                    const preset = presetById.get(line.presetId);
                    if (!preset) return null;
                    const other = isOtherPreset(preset);
                    const lineMinutes = other ? Math.max(60, line.manualDurationMinutes ?? 60) : preset.durationMinutesPerUnit * line.quantity;
                    return (
                      <div key={line.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, alignItems: 'center', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
                        <div>
                          <strong style={{ display: 'block', fontSize: '6.9px' }}>{preset.label}</strong>
                          <span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: '5.7px' }}>{durationLabel(lineMinutes)} scheduled{other ? ' · manual' : ` · ${durationLabel(preset.durationMinutesPerUnit)} each`}</span>
                        </div>
                        {other ? (
                          <label style={{ display: 'grid', gap: 3, minWidth: 105 }}><span>Manual hours</span><input type="number" min="1" max="12" step="0.5" value={(line.manualDurationMinutes ?? 60) / 60} onChange={(event) => changeManualHours(line.id, Number(event.target.value || 1))} /></label>
                        ) : (
                          <div className={styles.stepper}><button type="button" disabled={line.quantity <= 1} onClick={() => changeQuantity(line.id, -1)}>−</button><b>{line.quantity}</b><button type="button" disabled={line.quantity >= 20} onClick={() => changeQuantity(line.id, 1)}>＋</button></div>
                        )}
                        <button type="button" className={styles.secondaryButton} style={{ padding: '6px 8px' }} onClick={() => removeWorkLine(line.id)}>Remove</button>
                      </div>
                    );
                  })}
                </div>
              ) : <div className={styles.emptyResult}>Add the work expected for this visit. BTU is not required when scheduling.</div>}
              </>}

              <div className={styles.quantityRow}>
                <div><span>{projectMode ? 'Project task' : 'Work lines'}</span><strong>{projectMode ? selectedProjectPhase?.name || selectedProject?.type || '—' : `${workLines.length} line${workLines.length === 1 ? '' : 's'} · ${totalQuantity} item${totalQuantity === 1 ? '' : 's'}`}</strong></div>
                <div><span>{projectMode ? 'Planned Project slots' : 'Estimated workload'}</span><strong>{projectPlan ? `${projectPlan.scheduledSlots} slot${projectPlan.scheduledSlots === 1 ? '' : 's'}` : '—'}</strong></div>
                <div><span>{isAfterHours ? 'After-hours execution' : 'Scheduled allocation'}</span><strong>{isAfterHours ? 'Open-ended until field completion' : projectMode ? bookingBudgetPlan && selectedProject ? projectSlotLabel(bookingBudgetPlan.scheduledHours, selectedProject.slotDurationMinutes) : '—' : allocationDurationLabel(selectedValidatedOption ?? selectedCapacityOption, estimatedMinutes)}</strong></div>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.fieldWide}><span>Customer-facing work description</span><textarea value={authorizedDescription} onChange={(event) => { setDescription(event.target.value); invalidateOfferValidation(); }} placeholder={projectMode ? 'Project scope for this scheduled visit…' : 'Example: Two standard services and one installation. BTU to be confirmed by technician on site.'} /></label>
                <label className={styles.fieldWide}><span>Technician instructions</span><textarea value={authorizedTechnicianInstructions} onChange={(event) => { technicianInstructionsTouchedRef.current = true; setTechnicianInstructions(event.target.value); invalidateOfferValidation(); }} placeholder="Access instructions, contact person, equipment location, diagnostic notes…" /></label>
              </div>
            </div>
          </section>

          {isAfterHours ? (
            <section className={styles.authoritySection}>
              <div className={styles.authorityHeading}><div><span>4</span><strong>After-hours operational validation</strong><small>Booking Authority validates the same canonical customer, property, contacts, services, selected Van and dated crew when you confirm. This extra job remains open until real field completion.</small></div></div>
              <div className={styles.authorityIdle}>{selectedCustomer && selectedProperty && workValid && validAfterHoursStart(requestTarget.start)
                ? `${requestTarget.vanName} is selected for an extra job starting ${formatTime(requestTarget.start)}. No daytime capacity, planned end time or payroll overtime is fabricated.`
                : 'Complete the same customer, property and work details used by a Regular Booking, then choose a start at 5:00 PM or later.'}</div>
            </section>
          ) : (
          <section className={styles.authoritySection}>
            <div className={styles.authorityHeading}><div><span>5</span><strong>{backdatedTarget ? 'Historical capacity validation' : 'Live capacity validation'}</strong><small>{requestTarget.vanName} stays the primary/responsible van. Booking Authority validates automatically as the complete workload changes; final transaction validation still runs on confirm or hold.</small></div><button type="button" className={styles.validateButton} disabled={busy || checking || !selectedCustomer || !selectedProperty || !workValid || (backdatedTarget && !backdatingAcknowledged)} onClick={() => void validateTarget(false)}>{checking ? 'Checking…' : backdatedTarget ? 'Recheck history' : 'Recheck now'}</button></div>

            {supportSlotCandidates.length ? (
              <div style={{ margin: '10px 8px 0', padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div><strong style={{ display: 'block', fontSize: 7 }}>AVAILABLE SUPPORT SLOTS</strong><span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: 5.8 }}>Select {supportMinSlots === supportMaxSlots ? supportMinSlots : `${supportMinSlots}–${supportMaxSlots}`} open spot{supportMaxSlots === 1 ? '' : 's'}. You may combine different times and different Vans.</span></div>
                  <b style={{ color: 'var(--brand)', whiteSpace: 'nowrap', fontSize: 6.2 }}>{selectedSupportSlotIds.length} selected</b>
                </div>
                <div className={styles.choiceGrid}>
                  {supportSlotCandidates.map((candidate) => {
                    const selected = selectedSupportSlotIds.includes(candidate.id);
                    const lockedAtMinimum = selected && selectedSupportSlotIds.length <= supportMinSlots;
                    const lockedAtMaximum = !selected && supportMaxSlots > 0 && selectedSupportSlotIds.length >= supportMaxSlots;
                    return (
                      <button
                        type="button"
                        key={candidate.id}
                        className={`${styles.choice} ${selected ? styles.choiceSelected : ''}`}
                        aria-pressed={selected}
                        disabled={busy || checking || lockedAtMinimum || lockedAtMaximum}
                        onClick={() => toggleSupportSlot(candidate.id)}
                      >
                        <strong>{candidate.vanName || candidate.vanId} · support</strong>
                        <span>{formatTime(candidate.time)}–{formatTime(candidate.endTime)}</span>
                        <small>1 support spot · {selected ? 'SELECTED' : 'available'}</small>
                      </button>
                    );
                  })}
                </div>
                <div className={styles.authorityIdle} style={{ marginTop: 8 }}>
                  <strong>Allocation summary</strong>
                  <span style={{ display: 'block', marginTop: 4 }}>{requestTarget.vanName} · Primary / Responsible — {Math.max(0, totalQuantity - selectedSupportSlotIds.length)} unit{Math.max(0, totalQuantity - selectedSupportSlotIds.length) === 1 ? '' : 's'}</span>
                  {selectedSupportByVan.map((item) => <span key={item.vanId} style={{ display: 'block', marginTop: 2 }}>{item.vanName} · Support — {item.count} unit{item.count === 1 ? '' : 's'}</span>)}
                  <span style={{ display: 'block', marginTop: 4, fontWeight: 850 }}>Total scheduled — {totalQuantity} units</span>
                  <small style={{ display: 'block', marginTop: 5 }}>Consecutive selected spots on the same Van become one continuous support visit in the daily Van schedule. Non-consecutive spots remain separate visits in chronological order.</small>
                </div>
              </div>
            ) : null}

            {capacityValidation && selectedCapacityOption ? (
              <div className={styles.validationSuccess}>
                <header><div><b>✓</b><div><strong>{activeValidation ? 'Booking Authority approved the complete allocation' : 'Booking Authority approved this capacity allocation'}</strong><span>{activeValidation
                  ? `Offer ${activeValidation.offerId} · final transaction validation still runs on commit.`
                  : authorityError
                    ? 'The last approved capacity remains visible, but the current appointment details still need a fresh offer.'
                    : supportSlotCandidates.length
                      ? 'Validating the selected support spots with Booking Authority…'
                      : 'Capacity remains approved while appointment details synchronize with Booking Authority.'}</span></div></div></header>
                {!supportSlotCandidates.length && capacityValidation.options.length > 1 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 6, fontWeight: 850, marginBottom: 6 }}>VALID SUPPORT ALTERNATIVES</div>
                    <div className={styles.choiceGrid}>
                      {capacityValidation.options.map((option) => {
                        const supportWindows = optionSupportWindows(option);
                        const primary = optionPrimaryAssignment(option);
                        const primaryStart = primary ? optionAssignmentStart(option, primary) : option.time;
                        const primaryWorkEnd = primary ? optionAssignmentWorkEnd(option, primary) : option.endTime || '';
                        const primaryCapacityEnd = primary ? optionAssignmentCapacityEnd(option, primary) : option.capacityEndTime || primaryWorkEnd;
                        const selected = option.id === selectedCapacityOption.id;
                        return (
                          <button type="button" key={option.id} className={`${styles.choice} ${selected ? styles.choiceSelected : ''}`} aria-pressed={selected} onClick={() => setValidated((current) => current?.capacitySignature === capacitySignature ? { ...current, selectedOptionId: option.id } : current)}>
                            <strong>{supportWindows.length === 1
                              ? `${supportWindows[0].assignment.vanName || supportWindows[0].assignment.vanId} · support`
                              : supportWindows.length > 1 ? `${supportWindows.length} support Vans` : 'Primary allocation'}</strong>
                            {supportWindows.length ? supportWindows.map((window) => {
                              const support = window.assignment;
                              return <span key={`${support.vanId}-${window.start}-${window.capacityEnd}`}>
                                {supportWindows.length > 1 ? `${support.vanName || support.vanId} · ` : ''}Van capacity {formatTime(window.start)}{window.capacityEnd ? `–${formatTime(window.capacityEnd)}` : ''}
                                <small>
                                  {support.quantity} support unit{support.quantity === 1 ? '' : 's'}
                                  {!projectMode && window.workEnd && window.capacityEnd !== window.workEnd ? ` · Service-work estimate ends ${formatTime(window.workEnd)}` : ''}
                                </small>
                              </span>;
                            }) : <>
                              <span>Van capacity {formatTime(primaryStart)}{primaryCapacityEnd ? `–${formatTime(primaryCapacityEnd)}` : ''}</span>
                              <small>
                                No support van required
                                {!projectMode && primaryWorkEnd && primaryCapacityEnd !== primaryWorkEnd ? ` · Service-work estimate ends ${formatTime(primaryWorkEnd)}` : ''}
                              </small>
                            </>}
                            {supportWindows.length ? <small>{requestTarget.vanName} remains primary</small> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {displayAllocationOption ? (
                  <div className={styles.assignmentGrid}>
                    {displayAllocationOption.assignments.map((assignment, index) => {
                      const support = optionAssignmentIsSupport(displayAllocationOption, assignment);
                      const start = optionAssignmentStart(displayAllocationOption, assignment);
                      const workEnd = optionAssignmentWorkEnd(displayAllocationOption, assignment);
                      const capacityEnd = optionAssignmentCapacityEnd(displayAllocationOption, assignment);
                      return <article key={`${assignment.vanId}-${start}-${index}`}>
                        <span>{support ? 'SUPPORT' : 'PRIMARY / RESPONSIBLE'}</span>
                        <strong>{assignment.vanName || assignment.vanId}</strong>
                        <small>Van capacity {formatTime(start)}{capacityEnd ? `–${formatTime(capacityEnd)}` : ''} · {projectMode && selectedProject ? projectSlotLabel((assignment.durationMinutes || assignment.slots * 60) / 60, selectedProject.slotDurationMinutes) : durationLabel(assignment.durationMinutes || assignment.slots * 60)}</small>
                        {support ? <small>{assignment.quantity} support unit{assignment.quantity === 1 ? '' : 's'}</small> : null}
                        {!projectMode && workEnd && capacityEnd !== workEnd ? <small>Service-work estimate ends {formatTime(workEnd)}</small> : null}
                      </article>;
                    })}
                  </div>
                ) : supportSlotCandidates.length ? <div className={styles.authorityIdle} style={{ marginTop: 8 }}>Validating the exact selected support spots before this allocation can be confirmed…</div> : null}
                <div className={styles.authorityIdle} style={{ marginTop: 8 }}><strong>Temporary hold:</strong> reserves these same canonical capacity locks but sends no customer confirmation or reminder until an office user manually confirms it. No automatic expiry is assumed.</div>
              </div>
            ) : (
              <div className={styles.authorityIdle}>{supportSlotCandidates.length
                ? checking
                  ? 'Validating the selected support slots with Booking Authority…'
                  : 'Choose the required support spots above. Booking Authority will revalidate the complete primary + support allocation before confirmation.'
                : !backdatedTarget && selectedCustomer && selectedProperty && workValid && !authorityError
                  ? 'LIVE slot appears open · confirming Booking Authority'
                  : checking
                    ? 'Checking the complete allocation with Booking Authority…'
                    : projectMode
                      ? 'Select the Project, confirm its customer and property, then enter whole planned slots. Booking Authority will validate the real Van capacity automatically.'
                      : 'Complete the customer, property and work details. Booking Authority validates the live target automatically; the browser never becomes the source of truth for capacity.'}</div>
            )}
          </section>
          )}
        </div>

        <footer className={styles.footer}>
          {bookingRecovery ? <div role="alert">
            <p>La respuesta de la reserva está pendiente. Recupera la solicitud original antes de cambiar la selección o cerrar esta ventana.</p>
            <button type="button" className={styles.confirmButton} disabled={busy || projectWriteBlocked}
              onClick={() => void bookingRecovery.retry()}>Recuperar reserva original</button>
          </div> : <>
          <div><span>{isAfterHours ? 'CANONICAL EXTRA-WORK PATH' : projectMode ? 'PROJECT PREVIEW + CANONICAL SCHEDULING' : 'CANONICAL WRITE PATH'}</span><strong>{isAfterHours ? 'Booking Authority → Appointment + open-ended Work Order + Van guard' : projectMode ? 'Project → Booking Authority → Appointment + Work Order + Capacity Locks' : 'Booking Authority → Appointment + Work Order + Capacity Locks'}</strong></div>
          <div>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onClose}>Cancel</button>
            {!isAfterHours && !backdatedTarget ? <button type="button" className={styles.secondaryButton} style={{ color: 'var(--warning, #b45309)', borderColor: 'var(--warning, #f59e0b)' }} disabled={!selectedValidatedOption || busy || checking || projectWriteBlocked} title={projectWriteBlocked ? 'Projects management permission required' : undefined} onClick={() => void holdBooking()}>{holding ? 'Holding…' : 'Temporary hold'}</button> : null}
            <button type="button" className={styles.confirmButton} disabled={isAfterHours
              ? busy || !selectedCustomer || !selectedProperty || !workValid || !validAfterHoursStart(requestTarget.start)
              : !selectedValidatedOption || busy || checking || projectWriteBlocked || (backdatedTarget && !backdatingAcknowledged)} title={projectWriteBlocked ? 'Projects management permission required' : undefined} onClick={() => void confirmBooking()}>{saving ? 'Confirming…' : isAfterHours ? `Create for ${requestTarget.vanName}` : backdatedTarget ? 'Save backdated appointment' : 'Confirm appointment'}</button>
          </div>
          </>}
        </footer>
      </aside>
      {customerEditorOpen ? <PropertyEditor mode="create" requestId={masterRequestId.current} customerId="new-customer" customerName={customerDraft.name} contacts={[]} initial={emptyPropertyEditor}
        submitLabel="Crear cliente y propiedad" validationMessage={!customerDraft.name.trim() || !customerDraft.phone.trim() ? 'Completa el nombre y teléfono del cliente.' : undefined}
        onSave={saveCustomer} onClose={() => setCustomerEditorOpen(false)} extraFields={<>
          <div className={propertyEditorStyles.sectionTitle}><h3>Nuevo cliente</h3></div><div className={propertyEditorStyles.fields}>
            <label className={propertyEditorStyles.field}><span>Customer name *</span><input required value={customerDraft.name} onChange={(event) => setCustomerDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className={propertyEditorStyles.field}><span>Phone / WhatsApp *</span><input required value={customerDraft.phone} onChange={(event) => setCustomerDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
          </div><details className={propertyEditorStyles.disclosure}><summary>Más datos del cliente</summary><div className={propertyEditorStyles.fields}>
            <Field label="Company" value={customerDraft.company ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, company: value }))} />
            <Field label="WhatsApp if different" value={customerDraft.whatsapp ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, whatsapp: value }))} />
            <Field label="Email" value={customerDraft.email ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, email: value }))} type="email" />
            <label className={propertyEditorStyles.field}><span>Preferred language</span><select value={customerDraft.preferredLanguage} onChange={(event) => setCustomerDraft((current) => ({ ...current, preferredLanguage: event.target.value }))}><option>Papiamento</option><option>English</option><option>Español</option><option>Nederlands</option></select></label>
          </div></details>
          <details className={propertyEditorStyles.disclosure}><summary>Contactos generales de la propiedad</summary><PropertyContactDraftEditor clientId="new-customer" contacts={[]} links={customerPropertyDraft.contactLinks ?? []} onChange={(contactLinks) => setCustomerPropertyDraft((current) => ({ ...current, contactLinks }))} /></details>
          <div className={propertyEditorStyles.divider} />
        </>} /> : null}
      {propertyEditorOpen && selectedCustomer ? <PropertyEditor mode="create" requestId={masterRequestId.current} customerId={selectedCustomer.id} customerName={customerLabel(selectedCustomer)} contacts={references.contacts} initial={{ ...emptyPropertyEditor, zone: text(selectedCustomer.zone) }}
        onSave={saveProperty} onClose={() => setPropertyEditorOpen(false)} extraFields={<><details className={propertyEditorStyles.disclosure}><summary>Contactos generales de la propiedad</summary><PropertyContactDraftEditor clientId={selectedCustomer.id} contacts={references.contacts} links={propertyDraft.contactLinks ?? []} onChange={(contactLinks) => setPropertyDraft((current) => ({ ...current, contactLinks }))} /></details><div className={propertyEditorStyles.divider} /></>} /> : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', wide = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
}) {
  return <label className={wide ? styles.fieldWide : undefined}><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
