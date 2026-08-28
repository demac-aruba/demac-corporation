'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  canonicalVanId,
  loadCanonicalOperationsState,
  resolveCanonicalCrew,
  staffDisplayName,
  weekdayLabel,
  type CanonicalDailyVanAssignment,
  type CanonicalOperationsState,
  type CanonicalVan,
  type CanonicalVanHalfDaySchedule,
  type CanonicalVanMaintenanceLog,
} from '@/lib/canonical-operations';
import {
  deleteCanonicalDailyVanAssignment,
  saveCanonicalDailyVanAssignment,
  saveCanonicalVanHalfDaySchedule,
  saveCanonicalVanMaintenanceLog,
  saveCanonicalVanProfile,
} from '@/lib/canonical-operations-mutations';
import {
  buildVanSaveRecord,
  isTechnicalStaff,
  nextCanonicalVanId,
  validateDailyVanAssignment,
  workedMinutes,
} from '@/lib/van-profile';
import {
  getVanScheduleGroupSettings,
  saveVanScheduleGroupSetting,
  type VanScheduleGroupSetting,
} from '@/lib/van-schedule-settings';
import styles from './advanced-vans-workspace.module.css';

type VanTab = 'profile' | 'crew' | 'whatsapp' | 'capacity' | 'maintenance' | 'history';

type OverrideDraft = {
  date: string;
  driverStaffId: string;
  helperStaffId: string;
  additionalHelperStaffId: string;
  reason: string;
};

type MaintenanceDraft = {
  category: 'maintenance' | 'repair';
  date: string;
  odometerKm: string;
  type: string;
  description: string;
  vendor: string;
  cost: string;
  nextDueKm: string;
  nextDueDate: string;
  notes: string;
};

const VAN_STATUSES = ['Disponible', 'Mantenimiento', 'Fuera de servicio', 'Sin personal'] as const;
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

function arubaDateKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Aruba',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function newOverride(today: string): OverrideDraft {
  return { date: today, driverStaffId: '', helperStaffId: '', additionalHelperStaffId: '', reason: '' };
}

function newMaintenance(today: string, odometerKm?: number): MaintenanceDraft {
  return {
    category: 'maintenance', date: today, odometerKm: odometerKm ? String(odometerKm) : '', type: '', description: '',
    vendor: '', cost: '', nextDueKm: '', nextDueDate: '', notes: '',
  };
}

function cloneVan(van: CanonicalVan): CanonicalVan {
  return { ...van, technicianIds: [...(van.technicianIds ?? [])] };
}

export function AdvancedVansWorkspace() {
  const { principal } = useAuth();
  const today = arubaDateKey();
  const canManage = principal.active && principal.capabilities.has('scheduling.manage');
  const [state, setState] = useState<CanonicalOperationsState | null>(null);
  const [groups, setGroups] = useState<VanScheduleGroupSetting[]>([]);
  const [selectedVanId, setSelectedVanId] = useState('');
  const [draft, setDraft] = useState<CanonicalVan | null>(null);
  const [tab, setTab] = useState<VanTab>('crew');
  const [halfDayDraft, setHalfDayDraft] = useState<CanonicalVanHalfDaySchedule | null>(null);
  const [groupDraft, setGroupDraft] = useState<VanScheduleGroupSetting | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<OverrideDraft>(() => newOverride(today));
  const [maintenanceDraft, setMaintenanceDraft] = useState<MaintenanceDraft>(() => newMaintenance(today));
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refresh(preferredVanId?: string) {
    setLoading(true);
    setError('');
    try {
      const [operations, groupResult] = await Promise.all([
        loadCanonicalOperationsState(),
        getVanScheduleGroupSettings().catch(() => ({ success: true as const, version: 0, groups: [] as VanScheduleGroupSetting[] })),
      ]);
      setState(operations);
      setGroups(groupResult.groups);
      const nextVanId = preferredVanId || selectedVanId || canonicalVanId(operations.vans[0]?.id, operations.vans);
      setSelectedVanId(nextVanId);
      const nextVan = operations.vans.find((van) => canonicalVanId(van.id, operations.vans) === nextVanId) ?? operations.vans[0];
      if (nextVan) hydrateDrafts(nextVan, operations, groupResult.groups);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const canonicalVans = useMemo(() => {
    if (!state) return [] as CanonicalVan[];
    const byId = new Map<string, CanonicalVan>();
    for (const van of state.vans) {
      const id = canonicalVanId(van.id, state.vans);
      const existing = byId.get(id);
      if (!existing || van.id === id) byId.set(id, van);
    }
    return [...byId.values()].sort((a, b) => naturalVanNumber(a, state.vans) - naturalVanNumber(b, state.vans));
  }, [state]);

  const technicalStaff = useMemo(() => (state?.staffProfiles ?? []).filter((profile) => profile.active !== false && isTechnicalStaff(profile)), [state]);
  const drivers = useMemo(() => technicalStaff.filter((profile) => profile.canDriveVan === true), [technicalStaff]);
  const maintenanceLogs = useMemo(() => (state?.vanMaintenanceLogs ?? []).filter((log) => canonicalVanId(log.vanId, state?.vans ?? []) === selectedVanId), [selectedVanId, state]);
  const dailyOverrides = useMemo(() => (state?.dailyVanAssignments ?? []).filter((assignment) => canonicalVanId(assignment.vanId, state?.vans ?? []) === selectedVanId).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))), [selectedVanId, state]);

  function hydrateDrafts(van: CanonicalVan, operations: CanonicalOperationsState, groupSettings = groups) {
    const vanId = canonicalVanId(van.id, operations.vans);
    const halfDay = operations.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, operations.vans) === vanId);
    const group = groupSettings.find((item) => item.vanId === vanId);
    setDraft(cloneVan(van));
    setHalfDayDraft({
      id: halfDay?.id ?? `half-day-${vanId}`,
      vanId,
      weekday: halfDay?.weekday ?? 1,
      active: true,
      workdayStart: halfDay?.workdayStart ?? '08:00',
      workdayEnd: halfDay?.workdayEnd ?? '13:00',
      extraMorningSlot: halfDay?.extraMorningSlot,
      notes: halfDay?.notes,
    });
    setGroupDraft(group ?? { vanId, vanName: van.name ?? vanId, groupName: '', groupJid: '', enabled: true, configured: false });
    setOverrideDraft(newOverride(today));
    setMaintenanceDraft(newMaintenance(today, van.odometerKm));
    setCreating(false);
  }

  function selectVan(van: CanonicalVan) {
    if (!state) return;
    const vanId = canonicalVanId(van.id, state.vans);
    setSelectedVanId(vanId);
    hydrateDrafts(van, state);
    setTab('crew');
    setMessage(''); setError('');
  }

  function startCreateVan() {
    if (!state || !canManage) return;
    const id = nextCanonicalVanId(state.vans);
    const number = Number(id.replace('VAN-', ''));
    const next: CanonicalVan = {
      id,
      name: `Van ${number}`,
      plate: '',
      status: 'Fuera de servicio',
      responsibleStaffId: undefined,
      regularHelperId: undefined,
      additionalHelperId: undefined,
      technicianIds: [],
      active: true,
      createdAt: new Date().toISOString(),
    };
    setCreating(true);
    setSelectedVanId(id);
    setDraft(next);
    setHalfDayDraft({ id: `half-day-${id}`, vanId: id, weekday: 1, active: true, workdayStart: '08:00', workdayEnd: '13:00' });
    setGroupDraft({ vanId: id, vanName: next.name ?? id, groupName: '', groupJid: '', enabled: true, configured: false });
    setOverrideDraft(newOverride(today));
    setMaintenanceDraft(newMaintenance(today));
    setTab('profile');
    setError('');
    setMessage('New Vans start out of service so they cannot silently create booking capacity before the profile and crew are ready.');
  }

  async function saveVanAndSchedule() {
    if (!draft || !state || !halfDayDraft || !canManage) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const savedVan = await saveCanonicalVanProfile(buildVanSaveRecord(draft, state.staffProfiles));
      if (halfDayDraft.weekday !== undefined) {
        workedMinutes(halfDayDraft.workdayStart ?? '08:00', halfDayDraft.workdayEnd ?? '13:00');
        await saveCanonicalVanHalfDaySchedule({ ...halfDayDraft, vanId: canonicalVanId(savedVan.id, [...state.vans, savedVan]), active: true });
      }
      const id = canonicalVanId(savedVan.id, [...state.vans, savedVan]);
      await refresh(id);
      setCreating(false);
      setMessage(`${savedVan.name ?? id} profile, regular crew and schedule saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function saveWhatsApp() {
    if (!groupDraft || !canManage) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveVanScheduleGroupSetting({ vanId: groupDraft.vanId, groupName: groupDraft.groupName.trim(), groupJid: groupDraft.groupJid.trim(), enabled: groupDraft.enabled });
      setGroups(result.groups);
      setGroupDraft(result.groups.find((group) => group.vanId === groupDraft.vanId) ?? groupDraft);
      setMessage('WhatsApp schedule group saved for this Van.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function addDailyOverride() {
    if (!state || !draft || !canManage) return;
    const assignment: CanonicalDailyVanAssignment = {
      id: `daily-${selectedVanId}-${overrideDraft.date}`,
      date: overrideDraft.date,
      vanId: selectedVanId,
      driverStaffId: overrideDraft.driverStaffId || undefined,
      helperStaffId: overrideDraft.helperStaffId || undefined,
      additionalHelperStaffId: overrideDraft.additionalHelperStaffId || undefined,
      status: 'Disponible',
      reason: overrideDraft.reason.trim() || 'Temporary crew override',
      notes: overrideDraft.reason.trim() || undefined,
      createdByUserId: principal.userId,
      createdByName: principal.displayName,
      createdAt: new Date().toISOString(),
    };
    setBusy(true); setError(''); setMessage('');
    try {
      validateDailyVanAssignment(assignment, state.staffProfiles);
      await saveCanonicalDailyVanAssignment(assignment);
      setOverrideDraft(newOverride(today));
      await refresh(selectedVanId);
      setMessage('Daily crew override saved. The regular Van crew remains unchanged for all other dates.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function removeOverride(id: string) {
    if (!canManage || !window.confirm('Remove this date-specific crew override? The regular Van crew will be used again for that date.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await deleteCanonicalDailyVanAssignment(id);
      await refresh(selectedVanId);
      setMessage('Daily override removed.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function saveMaintenance() {
    if (!draft || !state || !canManage) return;
    if (!maintenanceDraft.date || !maintenanceDraft.type.trim() || !maintenanceDraft.description.trim()) {
      setError('Date, type and description are required for a maintenance or repair entry.');
      return;
    }
    const now = new Date().toISOString();
    const log: CanonicalVanMaintenanceLog = {
      id: `van-log-${selectedVanId}-${maintenanceDraft.date}-${crypto.randomUUID()}`,
      vanId: selectedVanId,
      date: maintenanceDraft.date,
      category: maintenanceDraft.category,
      odometerKm: numberOrUndefined(maintenanceDraft.odometerKm),
      type: maintenanceDraft.type.trim(),
      description: maintenanceDraft.description.trim(),
      vendor: maintenanceDraft.vendor.trim() || undefined,
      cost: numberOrUndefined(maintenanceDraft.cost),
      nextDueKm: numberOrUndefined(maintenanceDraft.nextDueKm),
      nextDueDate: maintenanceDraft.nextDueDate || undefined,
      notes: maintenanceDraft.notes.trim() || undefined,
      createdByUserId: principal.userId,
      createdByName: principal.displayName,
      createdAt: now,
    };
    setBusy(true); setError(''); setMessage('');
    try {
      await saveCanonicalVanMaintenanceLog(log);
      const updatedVan: CanonicalVan = {
        ...draft,
        odometerKm: log.odometerKm ?? draft.odometerKm,
        nextServiceKm: log.nextDueKm ?? draft.nextServiceKm,
        nextServiceDate: log.nextDueDate ?? draft.nextServiceDate,
      };
      await saveCanonicalVanProfile(buildVanSaveRecord(updatedVan, state.staffProfiles, now));
      setMaintenanceDraft(newMaintenance(today, updatedVan.odometerKm));
      await refresh(selectedVanId);
      setMessage(`${maintenanceDraft.category === 'repair' ? 'Repair' : 'Maintenance'} history entry saved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  if (loading && !state) return <div className={styles.loading}>Loading canonical Vans…</div>;
  if (!state) return <div className={styles.loading}>{error || 'Canonical Vans could not be loaded.'}</div>;

  const selectedStoredVan = canonicalVans.find((van) => canonicalVanId(van.id, state.vans) === selectedVanId);
  const currentVan = draft ?? selectedStoredVan ?? canonicalVans[0];
  if (!currentVan) return <div className={styles.page}><PageHeader onRefresh={() => void refresh()} loading={loading} canAdd={canManage} onAdd={startCreateVan} /><EmptyVans canManage={canManage} onAdd={startCreateVan} /></div>;

  const selectedCrew = !creating && selectedStoredVan ? resolveCanonicalCrew(selectedStoredVan, today, state) : null;
  const selectedHalfDay = halfDayDraft;
  const availableVans = canonicalVans.filter((van) => !['Mantenimiento', 'Fuera de servicio'].includes(van.status ?? '')).length;
  const configuredGroups = groups.filter((group) => group.configured && group.enabled).length;
  const tabs: Array<{ id: VanTab; label: string }> = [
    { id: 'profile', label: 'Profile' }, { id: 'crew', label: 'Crew & Schedule' }, { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'capacity', label: 'Capacity' }, { id: 'maintenance', label: 'Maintenance' }, { id: 'history', label: 'History' },
  ];

  return <div className={styles.page}>
    <PageHeader onRefresh={() => void refresh(selectedVanId)} loading={loading} canAdd={canManage} onAdd={startCreateVan} />
    <section className={styles.metrics}>
      <Metric label="Canonical Vans" value={`${canonicalVans.length} / ${Math.max(4, canonicalVans.length)}`} detail="Physical fleet" />
      <Metric label="Operational Profiles" value={String(availableVans)} detail="Not in maintenance / out of service" />
      <Metric label="WhatsApp Groups" value={`${configuredGroups} / ${Math.max(canonicalVans.length, 4)}`} detail="Automatic delivery" />
      <Metric label="Date Evaluated" value={formatDate(today)} detail="America/Aruba" />
    </section>

    {message ? <div className={styles.success}>{message}</div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}

    <section className={styles.workspace}>
      <aside className={styles.fleetPane}>
        <div className={styles.paneHead}><div><span>Fleet</span><strong>{canonicalVans.length} Vans</strong></div>{canManage ? <button className={styles.ghostButton} type="button" onClick={startCreateVan}>＋ Add Van</button> : null}</div>
        <div className={styles.vanList}>
          {canonicalVans.map((van) => {
            const vanId = canonicalVanId(van.id, state.vans);
            const crew = resolveCanonicalCrew(van, today, state);
            const halfDay = state.vanHalfDaySchedules.find((schedule) => canonicalVanId(schedule.vanId, state.vans) === vanId);
            const active = vanId === selectedVanId && !creating;
            return <button key={vanId} type="button" className={active ? styles.vanCardActive : styles.vanCard} onClick={() => selectVan(van)}>
              <div className={styles.vanCardTop}><div><span>{van.plate || vanId}</span><strong>{van.name ?? vanId}</strong></div><StatusBadge status={van.status ?? 'Disponible'} /></div>
              <div className={styles.vanCardMiddle}><div><p>{staffDisplayName(crew.driver)}{crew.helper ? ` · ${staffDisplayName(crew.helper)}` : ''}{crew.additionalHelper ? ` · ${staffDisplayName(crew.additionalHelper)}` : ''}</p><div className={styles.vanFacts}><span>Weekly partial day <b>{halfDay ? weekdayLabel(halfDay.weekday) : 'Not set'}</b></span><span>Crew source <b>{crew.daily ? 'Daily override' : 'Van profile'}</b></span></div></div><VanVisual van={van} /></div>
            </button>;
          })}
          {creating && draft ? <div className={styles.vanCardActive}><div className={styles.vanCardTop}><div><span>{draft.id}</span><strong>{draft.name}</strong></div><StatusBadge status={draft.status ?? 'Fuera de servicio'} /></div><div className={styles.newVanHint}>Unsaved new Van profile</div></div> : null}
        </div>
      </aside>

      <main className={styles.detailPane}>
        <header className={styles.vanHeader}><div><div className={styles.headerTitle}><h2>{currentVan.name ?? selectedVanId}</h2><StatusBadge status={currentVan.status ?? 'Disponible'} /></div><span>{currentVan.plate || selectedVanId}</span></div><div className={styles.headerActions}>{creating ? <span className={styles.unsaved}>Unsaved new Van</span> : null}<button className={styles.iconButton} type="button" title="Refresh" onClick={() => void refresh(selectedVanId)}>↻</button></div></header>
        <nav className={styles.tabs}>{tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? styles.tabActive : styles.tab} onClick={() => { setTab(item.id); setError(''); setMessage(''); }}>{item.label}</button>)}</nav>

        <div className={styles.tabBody}>
          {tab === 'profile' && draft ? <ProfileTab draft={draft} setDraft={setDraft} canManage={canManage} onSave={() => void saveVanAndSchedule()} busy={busy} /> : null}
          {tab === 'crew' && draft && halfDayDraft ? <CrewTab
            draft={draft} setDraft={setDraft} halfDay={halfDayDraft} setHalfDay={setHalfDayDraft} drivers={drivers} technicalStaff={technicalStaff}
            overrides={dailyOverrides} overrideDraft={overrideDraft} setOverrideDraft={setOverrideDraft} canManage={canManage} busy={busy}
            onSave={() => void saveVanAndSchedule()} onAddOverride={() => void addDailyOverride()} onRemoveOverride={(id) => void removeOverride(id)} state={state}
          /> : null}
          {tab === 'whatsapp' && groupDraft ? <WhatsAppTab group={groupDraft} setGroup={setGroupDraft} canManage={canManage} busy={busy} onSave={() => void saveWhatsApp()} /> : null}
          {tab === 'capacity' && draft ? <CapacityTab van={draft} crew={selectedCrew} halfDay={selectedHalfDay} group={groupDraft} /> : null}
          {tab === 'maintenance' && draft ? <MaintenanceTab van={draft} logs={maintenanceLogs} draft={maintenanceDraft} setDraft={setMaintenanceDraft} canManage={canManage} busy={busy} onSave={() => void saveMaintenance()} /> : null}
          {tab === 'history' && draft ? <HistoryTab van={draft} logs={maintenanceLogs} overrides={dailyOverrides} state={state} /> : null}
        </div>
      </main>
    </section>
  </div>;
}

function PageHeader({ onRefresh, loading, canAdd, onAdd }: { onRefresh: () => void; loading: boolean; canAdd: boolean; onAdd: () => void }) {
  return <section className={styles.pageHeader}><div><span className={styles.eyebrow}>Mobile Warehouses · Canonical Fleet</span><h1>Vans</h1><p>Manage Van profiles, regular crews, schedules, WhatsApp groups, capacity, maintenance and history from one canonical workspace.</p></div><div className={styles.pageActions}><button className={styles.ghostButton} type="button" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh Live Data'}</button>{canAdd ? <button className={styles.primaryButton} type="button" onClick={onAdd}>＋ Add Van</button> : null}</div></section>;
}

function ProfileTab({ draft, setDraft, canManage, onSave, busy }: { draft: CanonicalVan; setDraft: (van: CanonicalVan) => void; canManage: boolean; onSave: () => void; busy: boolean }) {
  return <div className={styles.twoColumn}>
    <Card title="Van Profile" subtitle="Canonical vehicle identity and operating status.">
      <div className={styles.profileHero}><VanVisual van={draft} large /><div><strong>{draft.name ?? draft.id}</strong><span>{draft.make || 'Vehicle make not set'} {draft.model || ''} {draft.year ? `· ${draft.year}` : ''}</span><small>{draft.imageUrl ? 'Custom Van image' : 'DEMAC Van placeholder — add an image URL when available'}</small></div></div>
      <div className={styles.formGrid}>
        <Field label="Canonical ID"><input className={styles.control} value={draft.id} disabled /></Field>
        <Field label="Van name"><input className={styles.control} value={draft.name ?? ''} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canManage} /></Field>
        <Field label="Plate"><input className={styles.control} value={draft.plate ?? ''} onChange={(event) => setDraft({ ...draft, plate: event.target.value })} disabled={!canManage} /></Field>
        <Field label="Operational status"><select className={styles.control} value={draft.status ?? 'Disponible'} onChange={(event) => setDraft({ ...draft, status: event.target.value })} disabled={!canManage}>{VAN_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></Field>
        <Field label="Make"><input className={styles.control} value={draft.make ?? ''} onChange={(event) => setDraft({ ...draft, make: event.target.value })} disabled={!canManage} /></Field>
        <Field label="Model"><input className={styles.control} value={draft.model ?? ''} onChange={(event) => setDraft({ ...draft, model: event.target.value })} disabled={!canManage} /></Field>
        <Field label="Year"><input className={styles.control} type="number" value={draft.year ?? ''} onChange={(event) => setDraft({ ...draft, year: numberOrUndefined(event.target.value) })} disabled={!canManage} /></Field>
        <Field label="Odometer (km)"><input className={styles.control} type="number" value={draft.odometerKm ?? ''} onChange={(event) => setDraft({ ...draft, odometerKm: numberOrUndefined(event.target.value) })} disabled={!canManage} /></Field>
        <Field label="Next service (km)"><input className={styles.control} type="number" value={draft.nextServiceKm ?? ''} onChange={(event) => setDraft({ ...draft, nextServiceKm: numberOrUndefined(event.target.value) })} disabled={!canManage} /></Field>
        <Field label="Next service date"><input className={styles.control} type="date" value={draft.nextServiceDate ?? ''} onChange={(event) => setDraft({ ...draft, nextServiceDate: event.target.value || undefined })} disabled={!canManage} /></Field>
        <Field label="Insurance expires"><input className={styles.control} type="date" value={draft.insuranceExpiresAt ?? ''} onChange={(event) => setDraft({ ...draft, insuranceExpiresAt: event.target.value || undefined })} disabled={!canManage} /></Field>
        <Field label="Registration expires"><input className={styles.control} type="date" value={draft.registrationExpiresAt ?? ''} onChange={(event) => setDraft({ ...draft, registrationExpiresAt: event.target.value || undefined })} disabled={!canManage} /></Field>
        <Field label="Van image URL" full><input className={styles.control} value={draft.imageUrl ?? ''} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value || undefined })} placeholder="https://…" disabled={!canManage} /></Field>
        <Field label="Internal notes" full><textarea className={styles.textarea} value={draft.notes ?? ''} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={!canManage} /></Field>
      </div>
      <SaveRow onSave={onSave} canManage={canManage} busy={busy} label="Save Van Profile" />
    </Card>
    <Card title="Profile Safety" subtitle="New Vans do not silently change capacity."><StatusLine label="New Van default" value="Out of service" good /><StatusLine label="Crew authority" value="Van profile" good /><StatusLine label="Employee primaryVanId" value="Read compatibility only" good /><StatusLine label="Existing records" value="Updated additively" good /></Card>
  </div>;
}

function CrewTab(props: {
  draft: CanonicalVan; setDraft: (van: CanonicalVan) => void; halfDay: CanonicalVanHalfDaySchedule; setHalfDay: (schedule: CanonicalVanHalfDaySchedule) => void;
  drivers: CanonicalOperationsState['staffProfiles']; technicalStaff: CanonicalOperationsState['staffProfiles']; overrides: CanonicalDailyVanAssignment[];
  overrideDraft: OverrideDraft; setOverrideDraft: (value: OverrideDraft) => void; canManage: boolean; busy: boolean; onSave: () => void; onAddOverride: () => void;
  onRemoveOverride: (id: string) => void; state: CanonicalOperationsState;
}) {
  const { draft, setDraft, halfDay, setHalfDay, drivers, technicalStaff, overrides, overrideDraft, setOverrideDraft, canManage, busy, onSave, onAddOverride, onRemoveOverride, state } = props;
  const minutes = safeWorkedMinutes(halfDay.workdayStart ?? '08:00', halfDay.workdayEnd ?? '13:00');
  return <div className={styles.stack}>
    <Card title="Regular Crew Assignment" subtitle="Set the default technician and helpers for this Van. These assignments belong to the Van profile.">
      <div className={styles.crewGrid}>
        <CrewSelect label="Responsible Technician / Driver" value={draft.responsibleStaffId ?? ''} profiles={drivers} onChange={(value) => setDraft({ ...draft, responsibleStaffId: value || undefined })} disabled={!canManage} required />
        <CrewSelect label="Regular Helper" value={draft.regularHelperId ?? ''} profiles={technicalStaff} onChange={(value) => setDraft({ ...draft, regularHelperId: value || undefined })} disabled={!canManage} required />
        <CrewSelect label="Third Helper (optional)" value={draft.additionalHelperId ?? ''} profiles={technicalStaff} onChange={(value) => setDraft({ ...draft, additionalHelperId: value || undefined })} disabled={!canManage} />
      </div>
      <Info>This is the regular crew for {draft.name ?? draft.id}. Daily overrides below are date-specific and never rewrite this regular assignment.</Info>
    </Card>

    <Card title="Weekly Partial Day (Crew Rule)" subtitle="Choose the crew's recurring partial day and exact worked hours. Only worked time is counted.">
      <div className={styles.scheduleGrid}>
        <Field label="Partial-day weekday"><select className={styles.control} value={halfDay.weekday ?? 1} onChange={(event) => setHalfDay({ ...halfDay, weekday: Number(event.target.value) })} disabled={!canManage}>{WEEKDAYS.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</select></Field>
        <Field label="Start"><input className={styles.control} type="time" value={halfDay.workdayStart ?? '08:00'} onChange={(event) => setHalfDay({ ...halfDay, workdayStart: event.target.value })} disabled={!canManage} /></Field>
        <Field label="End"><input className={styles.control} type="time" value={halfDay.workdayEnd ?? '13:00'} onChange={(event) => setHalfDay({ ...halfDay, workdayEnd: event.target.value })} disabled={!canManage} /></Field>
        <Field label="Worked time"><div className={styles.readonlyControl}>{formatMinutes(minutes)}</div></Field>
        <Field label="Crew source"><div className={styles.readonlyControl}>Van profile · Regular crew</div></Field>
      </div>
      <Info>Sunday is controlled by the company calendar and is not available as a recurring partial-day selection.</Info>
      <SaveRow onSave={onSave} canManage={canManage} busy={busy} label="Save Crew & Schedule" />
    </Card>

    <Card title="Daily Overrides" subtitle="Temporary crew changes for a specific date. The regular crew returns automatically afterward.">
      <div className={styles.overrideForm}>
        <Field label="Date"><input className={styles.control} type="date" value={overrideDraft.date} onChange={(event) => setOverrideDraft({ ...overrideDraft, date: event.target.value })} disabled={!canManage} /></Field>
        <CrewSelect label="Technician / Driver" value={overrideDraft.driverStaffId} profiles={drivers} onChange={(value) => setOverrideDraft({ ...overrideDraft, driverStaffId: value })} disabled={!canManage} compact />
        <CrewSelect label="Helper" value={overrideDraft.helperStaffId} profiles={technicalStaff} onChange={(value) => setOverrideDraft({ ...overrideDraft, helperStaffId: value })} disabled={!canManage} compact />
        <CrewSelect label="Additional Helper" value={overrideDraft.additionalHelperStaffId} profiles={technicalStaff} onChange={(value) => setOverrideDraft({ ...overrideDraft, additionalHelperStaffId: value })} disabled={!canManage} compact />
        <Field label="Reason"><input className={styles.control} value={overrideDraft.reason} onChange={(event) => setOverrideDraft({ ...overrideDraft, reason: event.target.value })} placeholder="Sick leave, special job support…" disabled={!canManage} /></Field>
        <button className={styles.ghostButton} type="button" onClick={onAddOverride} disabled={!canManage || busy}>＋ Add Override</button>
      </div>
      <div className={styles.tableWrap}><div className={styles.overrideTable}><div className={styles.tableHead}><span>Date</span><span>Technician / Driver</span><span>Helper</span><span>Additional Helper</span><span>Reason</span><span>Created By</span><span /></div>{overrides.length ? overrides.map((item) => <div className={styles.tableRow} key={item.id}><span>{item.date ?? '—'}</span><span>{nameById(item.driverStaffId, state)}</span><span>{nameById(item.helperStaffId, state)}</span><span>{nameById(item.additionalHelperStaffId, state)}</span><span>{item.reason || item.notes || 'Temporary override'}</span><span>{item.createdByName || 'ERP'}</span><button className={styles.deleteButton} type="button" onClick={() => onRemoveOverride(item.id)} disabled={!canManage || busy}>×</button></div>) : <div className={styles.emptyRow}>No date-specific crew overrides for this Van.</div>}</div></div>
      <div className={styles.warning}>Overrides only apply to their selected date. The regular crew remains the permanent Van configuration.</div>
    </Card>
  </div>;
}

function WhatsAppTab({ group, setGroup, canManage, busy, onSave }: { group: VanScheduleGroupSetting; setGroup: (group: VanScheduleGroupSetting) => void; canManage: boolean; busy: boolean; onSave: () => void }) {
  return <div className={styles.twoColumn}>
    <Card title="WhatsApp Schedule Group" subtitle="One group configuration per canonical Van for automatic daily Work Order delivery.">
      <div className={styles.formGrid}>
        <Field label="Group name" full><input className={styles.control} value={group.groupName} onChange={(event) => setGroup({ ...group, groupName: event.target.value })} disabled={!canManage} /></Field>
        <Field label="WhatsApp Group JID" full><input className={`${styles.control} ${styles.mono}`} value={group.groupJid} onChange={(event) => setGroup({ ...group, groupJid: event.target.value, configured: Boolean(event.target.value.trim()) })} placeholder="…@g.us" disabled={!canManage} /></Field>
        <label className={styles.checkbox}><input type="checkbox" checked={group.enabled} onChange={(event) => setGroup({ ...group, enabled: event.target.checked })} disabled={!canManage} /> Automatic schedule delivery active</label>
      </div>
      <SaveRow onSave={onSave} canManage={canManage} busy={busy} label="Save WhatsApp Group" />
    </Card>
    <Card title="Communication Authority" subtitle="No duplicate mapping screen."><StatusLine label="Van" value={group.vanId} good /><StatusLine label="Group status" value={group.configured ? 'Configured' : 'Not configured'} good={group.configured} /><StatusLine label="Automatic delivery" value={group.enabled ? 'Enabled' : 'Disabled'} good={group.enabled} /><Info>Scheduling uses this same canonical Van group configuration. We are not creating a second WhatsApp mapping.</Info></Card>
  </div>;
}

function CapacityTab({ van, crew, halfDay, group }: { van: CanonicalVan; crew: ReturnType<typeof resolveCanonicalCrew> | null; halfDay: CanonicalVanHalfDaySchedule | null; group: VanScheduleGroupSetting | null }) {
  const crewCount = [van.responsibleStaffId, van.regularHelperId, van.additionalHelperId].filter(Boolean).length;
  const partialMinutes = halfDay ? safeWorkedMinutes(halfDay.workdayStart ?? '08:00', halfDay.workdayEnd ?? '13:00') : 0;
  const operational = !['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(van.status ?? '');
  return <div className={styles.capacityGrid}>
    <MetricCard icon="👥" label="Regular Crew" value={`${crewCount} people`} detail={crewCount >= 2 ? 'Core crew configured' : 'Crew incomplete'} good={crewCount >= 2} />
    <MetricCard icon="🚐" label="Operational Status" value={van.status ?? 'Disponible'} detail={operational ? 'Eligible operational profile' : 'Not available for normal capacity'} good={operational} />
    <MetricCard icon="🕒" label="Partial Day" value={halfDay ? weekdayLabel(halfDay.weekday) : 'Not configured'} detail={halfDay ? `${halfDay.workdayStart ?? '08:00'}–${halfDay.workdayEnd ?? '13:00'} · ${formatMinutes(partialMinutes)} worked` : 'No recurring Van rule'} good={Boolean(halfDay)} />
    <MetricCard icon="💬" label="WhatsApp" value={group?.configured && group.enabled ? 'Configured' : 'Attention'} detail={group?.configured ? (group.enabled ? 'Automatic delivery active' : 'Delivery disabled') : 'Group mapping missing'} good={Boolean(group?.configured && group.enabled)} />
    <Card title="Today’s Crew Resolution" subtitle="Read-only projection from canonical crew authority."><StatusLine label="Driver" value={staffDisplayName(crew?.driver)} good={Boolean(crew?.driver && !crew.driverUnavailable)} /><StatusLine label="Helper" value={staffDisplayName(crew?.helper)} good={Boolean(crew?.helper && !crew.helperUnavailable)} /><StatusLine label="Third helper" value={crew?.additionalHelper ? staffDisplayName(crew.additionalHelper) : 'Optional / not assigned'} good={!crew?.additionalHelper || !crew.additionalHelperUnavailable} /><StatusLine label="Source" value={crew?.daily ? 'Daily override' : 'Van profile'} good /></Card>
    <Card title="Capacity Principle" subtitle="Derived, not duplicated."><Info>This tab summarizes the current Van/crew/schedule state. Booking Authority remains responsible for actual appointment capacity, conflicts and scheduling transactions.</Info></Card>
  </div>;
}

function MaintenanceTab({ van, logs, draft, setDraft, canManage, busy, onSave }: { van: CanonicalVan; logs: CanonicalVanMaintenanceLog[]; draft: MaintenanceDraft; setDraft: (draft: MaintenanceDraft) => void; canManage: boolean; busy: boolean; onSave: () => void }) {
  return <div className={styles.stack}>
    <div className={styles.twoColumn}>
      <Card title="Add Maintenance / Repair" subtitle="Uses the existing vanMaintenanceLogs history source.">
        <div className={styles.formGrid}>
          <Field label="Category"><select className={styles.control} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as 'maintenance' | 'repair' })} disabled={!canManage}><option value="maintenance">Maintenance</option><option value="repair">Repair</option></select></Field>
          <Field label="Date"><input className={styles.control} type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Odometer (km)"><input className={styles.control} type="number" value={draft.odometerKm} onChange={(event) => setDraft({ ...draft, odometerKm: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Type"><input className={styles.control} value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} placeholder="Oil service, brakes, A/C…" disabled={!canManage} /></Field>
          <Field label="Vendor / Garage"><input className={styles.control} value={draft.vendor} onChange={(event) => setDraft({ ...draft, vendor: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Cost (Afl.)"><input className={styles.control} type="number" value={draft.cost} onChange={(event) => setDraft({ ...draft, cost: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Next service (km)"><input className={styles.control} type="number" value={draft.nextDueKm} onChange={(event) => setDraft({ ...draft, nextDueKm: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Next service date"><input className={styles.control} type="date" value={draft.nextDueDate} onChange={(event) => setDraft({ ...draft, nextDueDate: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Description" full><textarea className={styles.textarea} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} disabled={!canManage} /></Field>
          <Field label="Notes" full><input className={styles.control} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} disabled={!canManage} /></Field>
        </div>
        <SaveRow onSave={onSave} canManage={canManage} busy={busy} label="Save History Entry" />
      </Card>
      <Card title="Service Readiness" subtitle="Current facts stored on the Van profile."><StatusLine label="Odometer" value={van.odometerKm != null ? `${van.odometerKm.toLocaleString()} km` : 'Not recorded'} good={van.odometerKm != null} /><StatusLine label="Next service km" value={van.nextServiceKm != null ? `${van.nextServiceKm.toLocaleString()} km` : 'Not set'} good={van.nextServiceKm != null} /><StatusLine label="Next service date" value={van.nextServiceDate || 'Not set'} good={Boolean(van.nextServiceDate)} /><StatusLine label="Insurance expires" value={van.insuranceExpiresAt || 'Not set'} good={Boolean(van.insuranceExpiresAt)} /><StatusLine label="Registration expires" value={van.registrationExpiresAt || 'Not set'} good={Boolean(van.registrationExpiresAt)} /></Card>
    </div>
    <Card title="Maintenance & Repair History" subtitle="Newest entries first; existing Legacy records remain readable."><HistoryTable logs={logs} /></Card>
  </div>;
}

function HistoryTab({ van, logs, overrides, state }: { van: CanonicalVan; logs: CanonicalVanMaintenanceLog[]; overrides: CanonicalDailyVanAssignment[]; state: CanonicalOperationsState }) {
  const events = [
    ...logs.map((log) => ({ id: log.id, date: log.date || log.updatedAt || '', type: log.category === 'repair' ? 'Repair' : 'Maintenance', title: log.type || 'Vehicle service', detail: log.description || log.notes || 'No description', by: log.createdByName || 'ERP / Legacy' })),
    ...overrides.map((item) => ({ id: item.id, date: item.date || item.updatedAt || '', type: 'Crew Override', title: `${nameById(item.driverStaffId, state)} · ${nameById(item.helperStaffId, state)}`, detail: item.reason || item.notes || 'Temporary crew override', by: item.createdByName || 'ERP' })),
    ...(van.updatedAt ? [{ id: `van-update-${van.updatedAt}`, date: van.updatedAt, type: 'Van Profile', title: 'Van profile updated', detail: van.notes || 'Canonical Van profile change', by: 'ERP' }] : []),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <Card title="Van History" subtitle="Operational events tied to this canonical Van.">{events.length ? <div className={styles.timeline}>{events.map((event) => <div className={styles.timelineItem} key={event.id}><div className={styles.timelineDot} /><div><span>{event.type}</span><strong>{event.title}</strong><p>{event.detail}</p><small>{formatDateTime(event.date)} · {event.by}</small></div></div>)}</div> : <div className={styles.emptyRow}>No history records found for this Van.</div>}</Card>;
}

function HistoryTable({ logs }: { logs: CanonicalVanMaintenanceLog[] }) {
  if (!logs.length) return <div className={styles.emptyRow}>No maintenance or repair history recorded yet.</div>;
  return <div className={styles.tableWrap}><div className={styles.historyTable}><div className={styles.historyHead}><span>Date</span><span>Category</span><span>Type</span><span>Description</span><span>Odometer</span><span>Cost</span><span>Next Due</span></div>{logs.map((log) => <div className={styles.historyRow} key={log.id}><span>{log.date || '—'}</span><span className={log.category === 'repair' ? styles.repairPill : styles.maintenancePill}>{log.category === 'repair' ? 'Repair' : 'Maintenance'}</span><span>{log.type || '—'}</span><span>{log.description || log.notes || '—'}</span><span>{log.odometerKm != null ? `${log.odometerKm.toLocaleString()} km` : '—'}</span><span>{log.cost != null ? `Afl. ${log.cost.toFixed(2)}` : '—'}</span><span>{log.nextDueKm ? `${log.nextDueKm.toLocaleString()} km` : log.nextDueDate || '—'}</span></div>)}</div></div>;
}

function CrewSelect({ label, value, profiles, onChange, disabled, required, compact }: { label: string; value: string; profiles: CanonicalOperationsState['staffProfiles']; onChange: (value: string) => void; disabled: boolean; required?: boolean; compact?: boolean }) {
  return <label className={compact ? styles.field : styles.crewField}><span>{label}{required ? ' *' : ''}</span><select className={styles.control} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}><option value="">Unassigned</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{staffDisplayName(profile)} · {profile.role || 'Technical staff'}</option>)}</select></label>;
}

function VanVisual({ van, large = false }: { van: CanonicalVan; large?: boolean }) {
  if (van.imageUrl) return <div className={large ? styles.vanImageLarge : styles.vanImage}><img src={van.imageUrl} alt={`${van.name ?? 'Van'} profile`} /></div>;
  return <div className={large ? styles.vanImageLarge : styles.vanImage} aria-label="Van illustration"><svg viewBox="0 0 150 80" role="img"><path d="M20 23h75c12 0 24 8 30 18l8 14v10H18V31c0-5 1-8 2-8Z" fill="currentColor" opacity=".13"/><path d="M24 27h66v27H24V27Zm70 2c10 1 19 7 25 16l5 9H94V29Z" fill="currentColor" opacity=".55"/><path d="M97 33c7 1 13 5 18 12h-18V33Z" fill="white" opacity=".86"/><circle cx="45" cy="62" r="11" fill="#23364d"/><circle cx="45" cy="62" r="5" fill="#dbe5ef"/><circle cx="111" cy="62" r="11" fill="#23364d"/><circle cx="111" cy="62" r="5" fill="#dbe5ef"/><path d="M18 54h118v8h-14a12 12 0 0 0-23 0H57a12 12 0 0 0-24 0H18v-8Z" fill="currentColor"/></svg></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function MetricCard({ icon, label, value, detail, good }: { icon: string; label: string; value: string; detail: string; good: boolean }) { return <article className={styles.metricCard}><i>{icon}</i><div><span>{label}</span><strong>{value}</strong><small className={good ? styles.goodText : styles.warnText}>{detail}</small></div></article>; }
function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) { return <section className={styles.card}><header><h3>{title}</h3><p>{subtitle}</p></header>{children}</section>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) { return <label className={`${styles.field} ${full ? styles.fieldFull : ''}`}><span>{label}</span>{children}</label>; }
function Info({ children }: { children: ReactNode }) { return <div className={styles.info}>{children}</div>; }
function SaveRow({ onSave, canManage, busy, label }: { onSave: () => void; canManage: boolean; busy: boolean; label: string }) { return <div className={styles.saveRow}><button className={styles.primaryButton} type="button" onClick={onSave} disabled={!canManage || busy}>{busy ? 'Saving…' : label}</button></div>; }
function StatusLine({ label, value, good = false }: { label: string; value: string; good?: boolean }) { return <div className={styles.statusLine}><b className={good ? styles.statusGood : styles.statusNeutral}>{good ? '✓' : '•'}</b><div><strong>{label}</strong><span>{value}</span></div></div>; }
function StatusBadge({ status }: { status: string }) { const risk = ['Mantenimiento', 'Fuera de servicio', 'Sin personal'].includes(status); return <span className={risk ? styles.statusRisk : styles.statusAvailable}>{status}</span>; }
function EmptyVans({ canManage, onAdd }: { canManage: boolean; onAdd: () => void }) { return <section className={styles.emptyState}><h2>No Vans found</h2><p>Create the first canonical Van profile when the vehicle and crew are ready.</p>{canManage ? <button className={styles.primaryButton} type="button" onClick={onAdd}>＋ Add Van</button> : null}</section>; }
function nameById(id: string | undefined, state: CanonicalOperationsState) { return staffDisplayName(state.staffProfiles.find((profile) => profile.id === id)); }
function naturalVanNumber(van: CanonicalVan, all: CanonicalVan[]) { const match = canonicalVanId(van.id, all).match(/(\d+)$/); return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER; }
function numberOrUndefined(value: string | number | undefined) { if (value === '' || value === undefined) return undefined; const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function safeWorkedMinutes(start: string, end: string) { try { return workedMinutes(start, end); } catch { return 0; } }
function formatMinutes(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return minutes ? `${hours}h ${minutes}m` : `${hours}h`; }
function formatDate(value: string) { if (!value) return '—'; const date = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date); }
function formatDateTime(value: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date); }
