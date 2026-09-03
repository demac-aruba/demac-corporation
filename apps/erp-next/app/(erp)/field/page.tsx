import { TechnicianFieldHome } from '../../../components/field/technician-field-home';

export default function FieldPage() {
  // Temporary owner-approved UAT aid. Access still requires the authenticated
  // Super Admin role; set the server-side flag to "false" to remove it.
  const enableAdminSimulation = process.env.FIELD_ADMIN_SIMULATOR_ENABLED?.trim().toLowerCase() !== 'false';
  return <TechnicianFieldHome enableAdminSimulation={enableAdminSimulation} />;
}
