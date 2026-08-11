import { BrowserInventoryReadiness } from '../../../components/inventory/browser-inventory-readiness';
import { BrowserInventoryReplenishment } from '../../../components/inventory/browser-inventory-replenishment';
import { BrowserInventoryTransfers } from '../../../components/inventory/browser-inventory-transfers';

export default function InventoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserInventoryReadiness /><BrowserInventoryReplenishment /><BrowserInventoryTransfers />{children}</>;
}
