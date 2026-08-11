import { SchedulingRuntimeBridge } from '../../../components/scheduling/scheduling-runtime-bridge';

export default function SchedulingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SchedulingRuntimeBridge>{children}</SchedulingRuntimeBridge>;
}
