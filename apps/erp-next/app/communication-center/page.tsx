import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { WhatsAppOperatorWorkspace } from '@/components/communications/whatsapp-operator-workspace';
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
            <WhatsAppOperatorWorkspace />
          </div>
        </main>
      </AccessibilityTextProvider>
    </AuthGate>
  );
}
