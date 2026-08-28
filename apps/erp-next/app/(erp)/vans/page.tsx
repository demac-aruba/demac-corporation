import { AdvancedVansWorkspace } from '@/components/vans/advanced-vans-workspace';
import styles from './van-photo-preview.module.css';

export default function VansPage() {
  return <div className={styles.realVanPhotos}><AdvancedVansWorkspace /></div>;
}
