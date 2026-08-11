import { BrowserReportDelivery } from '../../../components/communications/browser-report-delivery';

export default function CommunicationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserReportDelivery />{children}</>;
}
