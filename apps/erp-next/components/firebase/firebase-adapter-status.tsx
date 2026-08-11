'use client';

import { useEffect, useState } from 'react';
import { firebaseConfigurationSummary } from '@/lib/firebase/client-config';
import { loadFirebaseWebSession } from '@/lib/firebase/session';

export function FirebaseAdapterStatus() {
  const configuration = firebaseConfigurationSummary();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    setSessionEmail(loadFirebaseWebSession()?.email ?? null);
  }, []);

  return (
    <article className="panel sg-integration-card">
      <div className="sg-integration-head">
        <div className="sg-provider-mark">FB</div>
        <div><span>Core Data & Auth</span><h2>Firebase</h2></div>
        <b className={configuration.configured ? 'ready' : ''}>{configuration.configured ? 'Adapter Ready' : 'Config Pending'}</b>
      </div>
      <p>
        {configuration.configured
          ? 'ERP Next detected the existing Firebase web-client configuration at build time. Auth and Firestore REST adapters are ready, but production writes remain disabled until rules are reviewed.'
          : 'ERP Next now supports the existing Legacy Firebase environment names plus the new NEXT_PUBLIC names. No complete client configuration was detected in this build.'}
      </p>
      <div className="sg-integration-foot">
        <div>
          <span>Environment</span>
          <strong>{configuration.configured ? `${configuration.projectId ?? 'Firebase project'} · ${sessionEmail ? `session ${sessionEmail}` : 'not signed in'}` : 'Safe preview fallback'}</strong>
        </div>
        <button type="button">Rules draft prepared →</button>
      </div>
    </article>
  );
}
