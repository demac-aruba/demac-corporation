import type { VanResource } from './scheduling';

/**
 * Acceptance/demo fixture for the retired browser scheduling simulator.
 *
 * Production scheduling must load the canonical Van registry and ask Office
 * Booking Authority for options. Importing this fixture from an App Router
 * production entry is rejected by `booking-copilot-acceptance.ts`.
 */
export const legacySchedulingSimulatorVans: readonly VanResource[] = [
  { id: 'VAN-1', name: 'Van 1', team: 'Team 1', active: true, skills: ['service', 'repair', 'installation'] },
  { id: 'VAN-2', name: 'Van 2', team: 'Team 2', active: true, skills: ['service', 'repair', 'installation'] },
  { id: 'VAN-3', name: 'Van 3', team: 'Team 3', active: true, skills: ['service', 'repair', 'installation', 'commercial'] },
  { id: 'VAN-4', name: 'Van 4', team: 'Team 4', active: true, skills: ['service', 'diagnostic', 'repair'] },
];
