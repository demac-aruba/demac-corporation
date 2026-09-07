import Link from 'next/link';
import { CommunicationCenter } from '../../../components/communications/communication-center';
import styles from '../../../components/maya-operations-workspace.module.css';

export default function CustomerAiPage() {
  return <>
    <nav className={styles.workspaceNav} aria-label="Maya operations">
      <Link className={styles.workspaceLink} href="/customer-ai/operations">Cancellations & waiting list →</Link>
    </nav>
    <CommunicationCenter mode="ai" />
  </>;
}
