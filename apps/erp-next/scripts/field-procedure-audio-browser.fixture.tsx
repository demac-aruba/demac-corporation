import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProcedureAudioRecorder } from '../components/field/procedure-audio-recorder';
import { storeProcedureCapture, listProcedureCaptures, readProcedureCapture, hashProcedureBlob } from '../lib/field-procedure-capture-store';
import { persistFirebaseWebSession } from '../lib/firebase/session';
import { requestProcedureExit } from '../lib/field-procedure-navigation';
import styles from '../components/field/field-procedure-workspace.module.css';
const fixture = {attempts: [] as string[], exits: 0, switchAccount: (_uid: string) => {}, revision: (_n: number) => {}};
(window as unknown as {audioFixture: typeof fixture}).audioFixture = fixture;
function setSession(uid: string) {
  persistFirebaseWebSession({uid, email: uid + '@example.invalid', idToken: uid,
    refreshToken: 'synthetic-unused', expiresAt: Date.now() + 3_600_000, displayName: 'Synthetic audio fixture'});
}
function Inner({uid}: {uid: string}) {
  const target = {ownerUserId: uid, visitId: 'AUDIO-VISIT', interventionId: 'AUDIO-WI', assetId: 'AUDIO-ASSET'};
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(7);
  const [count, setCount] = useState(0), [sha, setSha] = useState(''), [url, setUrl] = useState('');
  const [capturedRevision, setCapturedRevision] = useState(-1), [source, setSource] = useState('');
  fixture.revision = setRevision;
  async function reload() {
    const rows = await listProcedureCaptures(target);
    const latest = rows.at(-1); if (!latest) { setCount(0); return; }
    const value = await readProcedureCapture(target, latest.id);
    if (!value?.blob) throw new Error('Expected protected original in synthetic fixture');
    setSha(value.sha256); setSource(value.source); setCapturedRevision(value.capturedSafetyRevision);
    setUrl(URL.createObjectURL(value.blob)); setCount(rows.length);
  }
  useEffect(() => { void reload(); }, []); // Fixture only: keyed account lifetime.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return <main className={styles.workspace}>
    <p>DEMO · synthetic source, native browser encoder and local original storage. No server or real microphone.</p>
    <ProcedureAudioRecorder target={target} part="indoor" stepId="I01" safetyRevision={revision} limitBytes={6*1024*1024}
      canRecord={true} onBusy={setBusy} onCapture={async input => {
        fixture.attempts.push(await hashProcedureBlob(input.blob));
        const saved = await storeProcedureCapture(target, input); await reload(); return saved;
      }}/>
    <button type="button" onClick={() => { if (requestProcedureExit()) fixture.exits++; }}>Salir del procedimiento</button>
    <output id="receipt" data-count={count} data-sha={sha} data-busy={String(busy)} data-source={source} data-revision={capturedRevision}/>
    {url ? <audio controls src={url} aria-label="Original protegido de prueba"/> : null}
  </main>;
}
function App() {
  const [uid, setUid] = useState('audio-test-tech');
  fixture.switchAccount = next => { setSession(next); setUid(next); };
  return <Inner key={uid} uid={uid}/>;
}
setSession('audio-test-tech');
createRoot(document.getElementById('root')!).render(<App/>);
