import Link from 'next/link';
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
      <WebsiteManagerWorkspace />
    </div>
  );
}
