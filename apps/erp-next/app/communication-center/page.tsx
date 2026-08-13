import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { CommunicationCenter } from '@/components/communications/communication-center';

export default function StandaloneCommunicationCenterPage() {
  return <AuthGate><AccessibilityTextProvider><CommunicationCenter /></AccessibilityTextProvider></AuthGate>;
}
