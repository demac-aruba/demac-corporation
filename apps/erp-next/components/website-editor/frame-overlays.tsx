'use client';
import { useEffect, useState } from 'react';
import styles from './website-editor.module.css';

const EDITABLE = '[data-website-text], [data-website-image]';
const INTERACTIVE = 'a,button,summary,form,input,select,textarea,[role="button"],[role="tab"],[role="link"]';

export default function FrameOverlays({ onSelect }: { onSelect: (field: string) => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    function hover(event: PointerEvent) {
      const origin = event.target instanceof Element ? event.target : null;
      // Keep the badge reachable; do not retain a misleading image selection
      // when the pointer moves over a link nested inside an editable background.
      if (origin?.closest('[data-editor-highlight]')) return;
      const item = origin?.closest<HTMLElement>(EDITABLE) || null;
      setTarget(item); setBox(item?.getBoundingClientRect() || null);
    }
    function click(event: MouseEvent) {
      const origin = event.target instanceof Element ? event.target : null;
      // Check the actual clicked descendant BEFORE its editable container.
      // A hero's background also contains CTA links and their SVG/span children.
      if (!origin || origin.closest(INTERACTIVE)) return;
      const item = origin.closest<HTMLElement>(EDITABLE);
      if (!item) return;
      setTarget(item); setBox(item.getBoundingClientRect());
      event.preventDefault(); event.stopPropagation();
      onSelect(item.dataset.websiteText || item.dataset.websiteImage || '');
    }
    document.addEventListener('pointerover', hover, true); document.addEventListener('click', click, true);
    return () => { document.removeEventListener('pointerover', hover, true); document.removeEventListener('click', click, true); };
  }, [onSelect]);
  useEffect(() => {
    if (!target) return;
    const update = () => setBox(target.isConnected ? target.getBoundingClientRect() : null);
    const observer = new ResizeObserver(update); observer.observe(target);
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [target]);
  if (!target || !box || box.width === 0 || box.height === 0) return null;
  const image = Boolean(target.dataset.websiteImage);
  return <div className={styles.highlight} data-editor-highlight style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
    <button type="button" className={styles.editBadge} aria-label={image ? 'Edit selected image' : 'Edit selected text'} onClick={() => onSelect(target.dataset.websiteImage || target.dataset.websiteText || '')}>✎ {image ? 'Edit image' : 'Edit text'}</button>
  </div>;
}
