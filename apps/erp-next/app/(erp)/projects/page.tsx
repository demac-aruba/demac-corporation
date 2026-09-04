import { ProjectsBrowserAutofillGuard } from '@/components/projects/projects-browser-autofill-guard';
import { ProjectsPhaseWorkspaceV2 } from '@/components/projects/projects-phase-workspace-v2';
import typography from '@/components/projects/projects-typography-contract.module.css';

export default function ProjectsPage() {
  return <div className={typography.scope} data-projects-autofill-scope data-demac-projects-typography="operational">
    <ProjectsBrowserAutofillGuard />
    <ProjectsPhaseWorkspaceV2 />
  </div>;
}
