'use client';
import { useEffect, useMemo, useState } from 'react';
import { readPublishedVrfContent } from '@/lib/public-vrf-public';
import { normalizePublicVrfContent, type PublicVrfContent } from '@/lib/public-vrf-content';
import { useWebsiteFrame } from '@/components/website-editor/frame-provider';
import { applyChanges, descriptors, isReviewBuild } from '@/lib/website-editor/contract';
import { VrfPageView } from './vrf-page-view';

export function VrfPageRuntime({ initialContent }: { initialContent: PublicVrfContent }) {
  const [published, setPublished] = useState(initialContent);
  const frame = useWebsiteFrame();
  useEffect(() => {
    let cancelled = false;
    // Static HTML remains the immediate fallback. This read uses the SAME
    // published JSON as Website Manager so content updates need no code merge.
    void readPublishedVrfContent().then((next) => { if (!cancelled && next) setPublished(normalizePublicVrfContent(next)); }).catch(() => { /* Keep the last valid rendered version. */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { if (frame.active) frame.register('vrf', published, descriptors(published)); }, [frame.active, frame.register, published]);
  const content = useMemo(() => {
    if (!frame.active || !frame.changes.length) return published;
    try { return applyChanges(published, frame.changes, { allowPreviewImages: isReviewBuild() }); }
    catch { return published; }
  }, [published, frame.active, frame.changes]);
  return <VrfPageView content={content} />;
}
