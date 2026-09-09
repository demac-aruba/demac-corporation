import { CareersHeader, CareersFooter } from './careers-chrome';
import s from './careers.module.css';
import layout from './careers-availability.module.css';

/** Public, read-only destination while recruitment intake is not released.
 * No example positions, form, subscriptions, documents or Careers API requests.
 * The existing live switch still owns activation; visibility is not activation.
 */
export function CareersAvailability() {
  return (
    <main className={s.root} data-careers-availability>
      <CareersHeader />
      <section className={`public-page-hero ${layout.hero}`} aria-labelledby="careers-title">
        <div className={`public-page-hero-inner ${layout.heroInner}`}>
          <div>
            <span className={s.eyebrow}>CAREERS AT DEMAC</span>
            <h1 id="careers-title">Careers</h1>
            <p>Join the DEMAC team.</p>
          </div>
        </div>
      </section>
      <section className={`${s.container} ${layout.body}`} aria-labelledby="careers-availability-title">
        <div className={layout.notice}>
          <span className={layout.badge}>Online recruitment</span>
          <h2 id="careers-availability-title">Applications are not open yet.</h2>
          <p>Thank you for your interest in joining DEMAC Professional Cooling Solutions.</p>
          <p>Please check back here for available positions and application details.</p>
        </div>
      </section>
      <CareersFooter />
    </main>
  );
}
