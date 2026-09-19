import { VrfWebsiteManagerWorkspace } from '@/components/vrf-website-manager-workspace';
import { WebsiteEditorLaunchButton } from '@/components/website-editor/launch-button';

export default function VrfWebsiteManagerPage() {
  // One writer after deliberate production activation. Existing canonical
  // content is retained; other Website Manager pages are unaffected.
  if (process.env.NEXT_PUBLIC_WEBSITE_EDITOR_MODE === 'live') return <section className="panel"><h2>VRF Website Manager</h2><p>Edit the same VRF content directly on the website. Drafts and versions are managed by the shared visual editor.</p><WebsiteEditorLaunchButton /><a className="btn" href="/website-manager/">Back to Website Manager</a></section>;
  return <VrfWebsiteManagerWorkspace />;
}
