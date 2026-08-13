import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { CommunicationCenter } from '@/components/communications/communication-center';
import styles from './standalone.module.css';

export default function StandaloneCommunicationCenterPage() {
  return (
    <AuthGate>
      <AccessibilityTextProvider>
        <main className={styles.shell}>
          <header className={styles.header}>
            <div className={styles.brand}>
              <span className={styles.mark}>WA</span>
              <div>
                <strong>DEMAC Communication Center</strong>
                <span>WhatsApp operator workspace</span>
              </div>
            </div>
            <span className={styles.status}><i /> Live workspace</span>
          </header>
          <div className={styles.host}>
            <CommunicationCenter standalone />
          </div>
        </main>
      </AccessibilityTextProvider>
    </AuthGate>
  );
}
