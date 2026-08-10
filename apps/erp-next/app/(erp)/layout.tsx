import { ErpShell } from '@/components/erp-shell';

export default function ErpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ErpShell>{children}</ErpShell>;
}
