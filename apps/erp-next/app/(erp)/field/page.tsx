import { TechnicianFieldHome } from '../../../components/field/technician-field-home';

export default function FieldPage() {
  const enableAdminSimulation = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development';
  return <TechnicianFieldHome enableAdminSimulation={enableAdminSimulation} />;
}
