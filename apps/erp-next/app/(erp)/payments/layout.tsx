import { BrowserPaymentAllocation } from '../../../components/finance/browser-payment-allocation';

export default function PaymentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserPaymentAllocation />{children}</>;
}
