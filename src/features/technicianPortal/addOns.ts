export type WorkVisitAddOnType = 'switch' | 'bracket' | 'armaflex' | 'refrigerant';
export type WorkVisitAddOnStatus = 'selected' | 'installed' | 'cancelled';

export interface WorkVisitAddOn {
  id: string;
  workOrderId: string;
  visitId: string;
  visitUnitId: string;
  interventionId: string;
  equipmentSystemId?: string;
  type: WorkVisitAddOnType;
  status: WorkVisitAddOnStatus;
  beforeEvidenceId?: string;
  afterEvidenceId?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
  createdByStaffId?: string;
  createdByName: string;
  updatedAt: string;
  updatedByUserId: string;
  updatedByStaffId?: string;
  updatedByName: string;
  version: number;
}

export type WorkVisitAddOnDefinition = {
  type: WorkVisitAddOnType;
  label: string;
  icon: string;
  description: string;
  beforeLabel: string;
  afterLabel: string;
  customerSummary: string;
};

export const WORK_VISIT_ADD_ON_DEFINITIONS: WorkVisitAddOnDefinition[] = [
  {
    type: 'switch',
    label: 'Switch / disconnect',
    icon: '⚡',
    description: 'Registra el reemplazo del switch de seguridad del aire.',
    beforeLabel: 'Switch anterior',
    afterLabel: 'Switch nuevo instalado',
    customerSummary: 'Se reemplazó el switch / disconnect de seguridad del equipo.',
  },
  {
    type: 'bracket',
    label: 'Bracket',
    icon: '▰',
    description: 'Registra el reemplazo del soporte de la condensadora.',
    beforeLabel: 'Bracket anterior',
    afterLabel: 'Bracket nuevo instalado',
    customerSummary: 'Se reemplazó el bracket o base de soporte de la unidad condensadora.',
  },
  {
    type: 'armaflex',
    label: 'Armaflex',
    icon: '◉',
    description: 'Registra el reemplazo del aislamiento de la tubería.',
    beforeLabel: 'Armaflex anterior',
    afterLabel: 'Armaflex nuevo instalado',
    customerSummary: 'Se reemplazó el aislamiento Armaflex de la tubería de refrigeración.',
  },
  {
    type: 'refrigerant',
    label: 'Gas / refrigerante',
    icon: '❄',
    description: 'Registra la corrección de la carga de refrigerante realizada durante el servicio.',
    beforeLabel: 'Manómetro antes de corregir la carga',
    afterLabel: 'Manómetro después de corregir la carga',
    customerSummary: 'Se corrigió la carga de refrigerante del equipo y se documentaron las presiones finales.',
  },
];

export function workVisitAddOnDefinition(type: WorkVisitAddOnType) {
  return WORK_VISIT_ADD_ON_DEFINITIONS.find((definition) => definition.type === type);
}

export function workVisitAddOnLabel(type: WorkVisitAddOnType) {
  return workVisitAddOnDefinition(type)?.label ?? type;
}
