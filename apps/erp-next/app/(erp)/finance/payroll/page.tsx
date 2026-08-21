import Link from 'next/link';
import { EmployeePayrollWorkspace } from '../../../../components/employees/employee-payroll-workspace';
import styles from './page.module.css';

export default function FinancePayrollPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.breadcrumb}><span>Finance</span><b>›</b><span>Payroll Review</span><b>›</b><span>Accounting Report</span></div>
          <h1>Payroll & Timesheet Review</h1>
          <p>Review the 27–26 payroll period from the configured employee schedules and the exceptions actually recorded. Generate a compact accountant-ready PDF directly from the ERP.</p>
        </div>
        <div className={styles.actions}><Link className={styles.link} href="/employees">Employees</Link><Link className={styles.link} href="/finance">Finance Center</Link></div>
      </header>
      <EmployeePayrollWorkspace />
    </div>
  );
}
