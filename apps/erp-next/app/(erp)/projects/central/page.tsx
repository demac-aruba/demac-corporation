import { ProjectsCentralGate } from '@/components/projects/central/projects-central-gate';
import typography from '@/components/projects/projects-typography-contract.module.css';

export default function CentralProjectsPage(){
  return <div className={typography.scope} data-demac-projects-typography="operational"><ProjectsCentralGate/></div>;
}
