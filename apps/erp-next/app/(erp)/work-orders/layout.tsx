import { OfficeReviewSurface } from '../../../components/work-orders/office-review-surface';

export default function WorkOrdersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><OfficeReviewSurface />{children}</>;
}
