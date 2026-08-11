import { BrowserWorkOrderHandoff } from '../../../components/work-orders/browser-work-order-handoff';
import { BrowserWorkOrderMaterials } from '../../../components/work-orders/browser-workorder-materials';
import { WorkOrderCommand } from '../../../components/work-orders/work-order-command';

export default function WorkOrdersPage() {
  return <><BrowserWorkOrderHandoff /><BrowserWorkOrderMaterials /><WorkOrderCommand /></>;
}
