import { BrowserAuditProjection } from '../../../components/governance/browser-audit-projection';

export default function AuditLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserAuditProjection />{children}</>;
}
