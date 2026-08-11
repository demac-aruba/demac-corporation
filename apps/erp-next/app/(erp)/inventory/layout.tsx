import { BrowserInventoryReadiness } from '../../../components/inventory/browser-inventory-readiness';

export default function InventoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserInventoryReadiness />{children}</>;
}
