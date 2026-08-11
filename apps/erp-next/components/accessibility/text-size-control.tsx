'use client';

import { useAccessibilityText } from './text-size-provider';
import styles from './text-size-control.module.css';

type Props = {
  compact?: boolean;
};

export function TextSizeControl({ compact = false }: Props) {
  const { textSizeOffset, setTextSizeOffset, increaseTextSize, decreaseTextSize, resetTextSize } = useAccessibilityText();
  const label = textSizeOffset === 0 ? 'Standard' : `+${textSizeOffset}px`;

  return (
    <section className={`${styles.control} ${compact ? styles.compact : ''}`} aria-label="Accessibility text size">
      <div className={styles.heading}>
        <div><span>Accessibility</span><strong>Text Size</strong></div>
        <b>{label}</b>
      </div>

      <div className={styles.stepper}>
        <button type="button" onClick={decreaseTextSize} disabled={textSizeOffset === 0} aria-label="Decrease text size by one pixel">A−</button>
        <div><strong>{label}</strong><span>{textSizeOffset === 0 ? 'Approved default typography' : `${textSizeOffset}px larger than the approved default`}</span></div>
        <button type="button" onClick={increaseTextSize} disabled={textSizeOffset === 4} aria-label="Increase text size by one pixel">A+</button>
      </div>

      {!compact ? <>
        <div className={styles.options} aria-label="Text size presets">
          {[0, 1, 2, 3, 4].map((offset) => (
            <button type="button" key={offset} className={textSizeOffset === offset ? styles.active : ''} onClick={() => setTextSizeOffset(offset)}>
              {offset === 0 ? 'Standard' : `+${offset}`}
            </button>
          ))}
        </div>
        <div className={styles.preview}>
          <span>LIVE PREVIEW</span>
          <strong>Customer, schedule and operational text</strong>
          <p>Only operational/supporting typography grows. H1, H2 and H3 page titles remain at their designed size.</p>
        </div>
        <footer><span>Maximum enlargement: +4 px</span><button type="button" onClick={resetTextSize} disabled={textSizeOffset === 0}>Reset to Standard</button></footer>
      </> : null}
    </section>
  );
}
