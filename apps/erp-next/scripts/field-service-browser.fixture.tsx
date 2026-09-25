// Synthetic component-only fixture. This never mounts in an application route.
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { FieldExecutionJobDetail } from '../lib/field-authority';
import { PlannedInterventionControls } from '../components/field/planned-intervention-controls';
import { AdditionalInterventionControls } from '../components/field/additional-intervention-controls';

declare global {
  interface Window {
    serviceTestMode: 'planned' | 'additional';
    serviceEvents: unknown[];
    changeServiceFixture: (change: string) => void;
  }
}

// Only fields consumed by these components are present; this is not an API fixture.
const initial = {
  id: 'DEMO-WO', workOrderId: 'DEMO-WO', customerId: 'DEMO-CUSTOMER', propertyId: 'DEMO-PROPERTY', propertyName: 'DEMO · Apartamento de prueba', address: 'Dirección sintética',
  fieldVisit: { id: 'DEMO-VISIT', status: 'in_progress' },
  plannedWork: [{ id: 'PLAN-1', label: 'Standard Service · plan original', quantity: 2 }, { id: 'PLAN-2', label: 'Inspección programada', quantity: 1 }],
  visitAssets: [
    { id: 'VA-1', assetId: 'AC-1', sequence: 1, locationLabel: 'Sala' },
    { id: 'VA-2', assetId: 'AC-2', sequence: 2, locationLabel: 'Sala' },
  ],
  knownEquipment: [{ id: 'AC-1', systemType: 'Split', btu: 18000, brand: 'DEMO' }, { id: 'AC-2', systemType: 'Split', btu: 12000, brand: 'DEMO' }],
  workInterventions: [], scopeChanges: [], plannedWorkDispositions: [], plannedWorkDispositionOptions: [], canRecordPlannedWorkDisposition: false,
  plannedInterventionOptions: [{ visitAssetId: 'VA-1', plannedWorkLineIds: ['PLAN-1','PLAN-2'] }, { visitAssetId: 'VA-2', plannedWorkLineIds: ['PLAN-1'] }],
  canAddPlannedIntervention: true, canAddAdditionalIntervention: true, additionalInterventionVisitAssetIds: ['VA-1','VA-2'],
  availableFieldServices: [
    { id: 'SVC-1', bookingCode: 'standard_service', label: 'Standard Service', kind: 'service', durationMinutesPerUnit: 60 },
    { id: 'SVC-2', bookingCode: 'deep_cleaning', label: 'Deep Cleaning', kind: 'service', durationMinutesPerUnit: 120 },
    { id: 'SVC-3', bookingCode: 'checkup', label: 'Check-up', kind: 'service', durationMinutesPerUnit: 60 },
    { id: 'SVC-4', bookingCode: 'repair', label: 'Reparación', kind: 'service', durationMinutesPerUnit: 60 },
    { id: 'SVC-5', bookingCode: 'custom-1', label: 'Servicio <script>window.injected=true</script> con nombre extenso del catálogo autorizado', kind: 'custom', durationMinutesPerUnit: 60 },
    { id: 'SVC-6', bookingCode: 'custom-2', label: 'Standard Service', kind: 'custom', durationMinutesPerUnit: 60 },
  ],
} as unknown as FieldExecutionJobDetail;
function Fixture() {
  const [job, setJob] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  window.changeServiceFixture = (change) => flushSync(() => {
    if (change === 'busy') setBusy(true);
    if (change === 'error') { setBusy(false); setError('Error de prueba: conserva tu selección y reintenta.'); }
    if (change === 'idle') { setBusy(false); setError(null); }
    if (change === 'remove-service') setJob((value) => ({ ...value, availableFieldServices: value.availableFieldServices.filter((s) => s.id !== 'SVC-1') }));
    if (change === 'empty-catalog') setJob((value) => ({ ...value, availableFieldServices: [] }));
    if (change === 'remove-line') setJob((value) => ({ ...value, plannedInterventionOptions: [{ visitAssetId: 'VA-1', plannedWorkLineIds: ['PLAN-2'] }] }));
    if (change === 'revoke') setJob((value) => ({ ...value, canAddPlannedIntervention: false, canAddAdditionalIntervention: false }));
    if (change === 'other-job') setJob((value) => ({ ...value, workOrderId: 'OTHER-WO', propertyId: 'OTHER-PROPERTY' }));
  });
  const props = { job, mutationBusy: busy, creatingVisitAssetId: busy ? 'VA-1' : null, error, onCreate: (input: unknown) => { window.serviceEvents.push(input); setBusy(true); } };
  return <main style={{ maxWidth: 840, margin: '0 auto', padding: 12 }}>
    <p>DEMO · Prueba de componentes · sin conexión a servicios</p>
    {window.serviceTestMode === 'additional' ? <AdditionalInterventionControls {...props} /> : <PlannedInterventionControls {...props} />}
  </main>;
}
window.serviceEvents = [];
createRoot(document.getElementById('root')!).render(<Fixture />);
