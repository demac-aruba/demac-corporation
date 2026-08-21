import { BrowserCommercialClearance } from '../../../components/work-orders/browser-commercial-clearance';
import { BrowserJobReadiness } from '../../../components/work-orders/browser-job-readiness';
import { BrowserSiteAccess } from '../../../components/work-orders/browser-site-access';
import { BrowserWorkOrderHandoff } from '../../../components/work-orders/browser-work-order-handoff';
import { WorkOrderCommand } from '../../../components/work-orders/work-order-command';

export default function WorkOrdersPage() {
  return <><BrowserWorkOrderHandoff /><BrowserSiteAccess /><BrowserCommercialClearance /><BrowserJobReadiness /><WorkOrderCommand /></>;
}
