import { BrowserFieldConsumption } from '../../../components/inventory/browser-field-consumption';

export default function InventoryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserFieldConsumption />{children}</>;
}
