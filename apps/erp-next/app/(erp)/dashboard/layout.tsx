import { BrowserLiveCommandCenter } from '../../../components/dashboard/browser-live-command-center';

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserLiveCommandCenter />{children}</>;
}
