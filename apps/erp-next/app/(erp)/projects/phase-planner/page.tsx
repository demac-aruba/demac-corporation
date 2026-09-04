import { ProjectsBrowserAutofillGuard } from '@/components/projects/projects-browser-autofill-guard';
import { ProjectsPhaseWorkspaceV2 } from '@/components/projects/projects-phase-workspace-v2';

export default function ProjectPhasePlannerPage() {
  return <div data-projects-autofill-scope>
    <ProjectsBrowserAutofillGuard />
    <ProjectsPhaseWorkspaceV2 />
  </div>;
}
