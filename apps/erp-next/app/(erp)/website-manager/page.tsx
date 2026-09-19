import Link from 'next/link';
import { WebsiteEditorLaunchButton } from '@/components/website-editor/launch-button';
import { WebsiteManagerWorkspace } from '@/components/website-manager-workspace';

export default function WebsiteManagerPage() {
  return (
    <div className="ps-stack">
      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Managed Service Pages</h2>
            <span>Edit service-page content without bypassing the Website Manager publishing workflow.</span>
          </div>
          <Link className="btn primary" href="/website-manager/vrf">Manage VRF Systems Page</Link>
        </header>
      </section>
      <section className="panel"><header className="panel-head"><div><h2>Visual Content Editor</h2><span>Open the actual website in a separate editing tab. Text and images only; Careers, forms and behavior stay protected.</span></div><WebsiteEditorLaunchButton /></header></section>
      <WebsiteManagerWorkspace />
    </div>
  );
}
