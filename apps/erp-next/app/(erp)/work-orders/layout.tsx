import { BrowserOfficeReviewQueue } from '../../../components/work-orders/browser-office-review-queue';

export default function WorkOrdersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><BrowserOfficeReviewQueue />{children}</>;
}
