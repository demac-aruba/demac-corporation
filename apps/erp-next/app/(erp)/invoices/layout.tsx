import { BrowserBillingReadiness } from '../../../components/finance/browser-billing-readiness';

export default function InvoicesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserBillingReadiness />{children}</>;
}
