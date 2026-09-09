'use client';
import { useAuth } from '../../../components/auth/auth-provider';
import { RecruitmentWorkspace } from '../../../components/recruitment/recruitment-workspace';
import s from '../../../components/recruitment/recruitment.module.css';

/** Only mount the data-fetching workspace after the existing ERP session is authorized.
 * This presentation guard does not replace careersAdmin's token and users-record checks.
 */
export default function RecruitmentPage() {
  const { status, mode, principal } = useAuth();
  if (status === 'loading') return <p role="status">Loading Recruitment…</p>;
  if (mode !== 'firebase' || !principal.active || principal.role !== 'super_admin') {
    return <section className={s.root}><div className={s.notice}>Recruitment is restricted to authorized DEMAC administrators.</div></section>;
  }
  return <RecruitmentWorkspace />;
}
