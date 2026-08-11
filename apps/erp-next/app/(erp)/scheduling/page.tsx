import { BrowserDispatchOperations } from '../../../components/scheduling/browser-dispatch-operations';
import { BrowserDispatchReadinessBoard } from '../../../components/scheduling/browser-dispatch-readiness-board';
import { DispatchWorkspace } from '../../../components/scheduling/dispatch-workspace';

export default function SchedulingPage() {
  return <><BrowserDispatchOperations /><BrowserDispatchReadinessBoard /><DispatchWorkspace /></>;
}
