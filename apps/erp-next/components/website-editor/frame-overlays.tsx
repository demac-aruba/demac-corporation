'use client';
import { useEffect, useState } from 'react';
import styles from './website-editor.module.css';

export default function FrameOverlays({ onSelect }: { onSelect: (field: string) => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    const find = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>('[data-website-text], [data-website-image]') : null;
    function hover(event: PointerEvent) { const item = find(event.target); if (item) { setTarget(item); setBox(item.getBoundingClientRect()); } }
    function click(event: MouseEvent) {
      const item = find(event.target); if (!item) return;
      setTarget(item); setBox(item.getBoundingClientRect());
      // Never steal a navigation, tab, disclosure, form or link action.
      if (item.closest('a,button,summary,form,input,select,textarea')) return;
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
