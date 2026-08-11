import { BrowserCustomerTimeline } from '../../../components/crm/browser-customer-timeline';

export default function CrmLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserCustomerTimeline />{children}</>;
}
