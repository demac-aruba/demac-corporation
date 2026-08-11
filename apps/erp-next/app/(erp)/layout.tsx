import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { DemoDataGate } from '@/components/demo/demo-data-gate';
import { ErpShell } from '@/components/erp-shell';

export default function ErpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AccessibilityTextProvider><ErpShell><DemoDataGate>{children}</DemoDataGate></ErpShell></AccessibilityTextProvider>;
}
