'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { loadPublishedWebsiteContent } from '@/lib/public-website-public';
import {
  defaultPublicWebsiteContent,
  type PublicWebsiteContent,
  type WebsiteHeroSlide,
} from '@/lib/public-website-content';

type PublicHeroSliderProps = {
  initialContent?: PublicWebsiteContent;
  previewContent?: PublicWebsiteContent;
  compactPreview?: boolean;
};

function enabledSlides(content: PublicWebsiteContent) {
  const enabled = content.hero.slides.filter((slide) => slide.enabled && slide.imageUrl);
  return enabled.length ? enabled : defaultPublicWebsiteContent.hero.slides.slice(0, 1);
}

function sliderStyle(slide: WebsiteHeroSlide, transitionMs: number) {
  return {
    '--hero-desktop-position': slide.desktopPosition || 'center right',
    '--hero-mobile-position': slide.mobilePosition || slide.desktopPosition || 'center right',
    '--hero-transition-ms': `${transitionMs}ms`,
  } as CSSProperties;
}

function preloadImage(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    const done = () => resolve();
    image.onload = done;
    image.onerror = done;
    image.src = src;
    if (image.complete) resolve();
  });
}

export function PublicHeroSlider({ initialContent = defaultPublicWebsiteContent, previewContent, compactPreview = false }: PublicHeroSliderProps) {
  const [content, setContent] = useState(previewContent ?? initialContent);
  const [publishedReady, setPublishedReady] = useState(Boolean(previewContent));
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchPaused, setTouchPaused] = useState(false);
  const [autoplayCycle, setAutoplayCycle] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const slides = useMemo(() => enabledSlides(content), [content]);

  useEffect(() => {
    if (previewContent) {
      setContent(previewContent);
      setPublishedReady(true);
      return;
    }

    let cancelled = false;
    setPublishedReady(false);

    void loadPublishedWebsiteContent().then(async (published) => {
      const firstSlide = enabledSlides(published)[0];
      if (firstSlide?.imageUrl) await preloadImage(firstSlide.imageUrl);
      if (cancelled) return;
      setContent(published);
      setActiveIndex(0);
      setPublishedReady(true);
    });

    return () => { cancelled = true; };
  }, [previewContent]);

  useEffect(() => {
    if (activeIndex >= slides.length) setActiveIndex(0);
  }, [activeIndex, slides.length]);

  const go = useCallback((direction: number) => {
    setActiveIndex((current) => (current + direction + slides.length) % slides.length);
  }, [slides.length]);

  const manualGo = useCallback((direction: number) => {
    go(direction);
    setAutoplayCycle((cycle) => cycle + 1);
  }, [go]);

  const manualSelect = useCallback((index: number) => {
    setActiveIndex(index);
    setAutoplayCycle((cycle) => cycle + 1);
  }, []);

  useEffect(() => {
    if (previewContent || compactPreview || !publishedReady || touchPaused || slides.length <= 1) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;
    const timer = window.setInterval(() => go(1), content.hero.autoplayMs);
    return () => window.clearInterval(timer);
  }, [autoplayCycle, compactPreview, content.hero.autoplayMs, go, publishedReady, previewContent, slides.length, touchPaused]);

  function touchStart(event: React.TouchEvent<HTMLElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
    touchStartY.current = event.touches[0]?.clientY ?? null;
    setTouchPaused(true);
  }

  function touchEnd(event: React.TouchEvent<HTMLElement>) {
    const startX = touchStartX.current;
    const startY = touchStartY.current;
    const end = event.changedTouches[0];
    touchStartX.current = null;
    touchStartY.current = null;
    window.setTimeout(() => setTouchPaused(false), 800);
    if (startX == null || startY == null || !end) return;
    const dx = end.clientX - startX;
    const dy = end.clientY - startY;
    if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy) * 1.15) return;
    manualGo(dx < 0 ? 1 : -1);
  }

  const isPublicLoading = !previewContent && !compactPreview && !publishedReady;
  if (isPublicLoading) {
    return (
      <section
        className="approved-hero public-hero-slider is-loading"
        id="home"
        aria-busy="true"
        aria-label="Loading DEMAC featured cooling solutions"
      >
        <div className="public-hero-loading-shell" aria-hidden="true" />
      </section>
    );
  }

  const active = slides[activeIndex] ?? slides[0];
  if (!active) return null;

  return (
    <section
      className={`approved-hero public-hero-slider${compactPreview ? ' is-preview' : ''}`}
      id={compactPreview ? undefined : 'home'}
      onTouchStart={touchStart}
      onTouchEnd={touchEnd}
      aria-roledescription="carousel"
      aria-label="DEMAC featured cooling solutions"
    >
      <div className="public-hero-media" aria-hidden="true">
        {slides.map((slide, index) => (
          <div
            className={`public-hero-media-slide${index === activeIndex ? ' is-active' : ''}`}
            key={slide.id}
            style={sliderStyle(slide, content.hero.transitionMs)}
          >
            <picture>
              {slide.mobileImageUrl ? <source media="(max-width: 720px)" srcSet={slide.mobileImageUrl} /> : null}
              <img src={slide.imageUrl} alt="" />
            </picture>
          </div>
        ))}
      </div>
      <div className="approved-hero-fade" aria-hidden="true" />
      <div className="approved-hero-inner">
        <div className="approved-hero-copy public-hero-copy" key={active.id}>
          <span className="approved-kicker">{active.eyebrow}</span>
          <h1>{active.title} <em>{active.accent}</em></h1>
          <p>{active.description}</p>
          <div className="approved-hero-actions">
            <Link className="public-button public-button-primary approved-main-button" href={active.primaryCta.href}>▣ {active.primaryCta.label}</Link>
            <Link className="public-button public-button-whatsapp approved-main-button" href={active.secondaryCta.href}>◉ {active.secondaryCta.label}</Link>
          </div>
          {!compactPreview ? (
            <div className="approved-trust-row">
              <span><b>✓</b> Aruba-based team</span>
              <span><b>⚙</b> Fast & reliable service</span>
              <span><b>◇</b> Residential to commercial</span>
              <span><b>✓</b> Island-wide service</span>
            </div>
          ) : null}
        </div>
      </div>

      {slides.length > 1 ? (
        <div className="public-hero-controls" aria-label="Hero banner controls">
          <button type="button" onClick={() => manualGo(-1)} aria-label="Previous banner">‹</button>
          <div className="public-hero-dots">
            {slides.map((slide, index) => (
              <button
                type="button"
                className={index === activeIndex ? 'is-active' : ''}
                onClick={() => manualSelect(index)}
                aria-label={`Show ${slide.name}`}
                aria-current={index === activeIndex ? 'true' : undefined}
                key={slide.id}
              />
            ))}
          </div>
          <button type="button" onClick={() => manualGo(1)} aria-label="Next banner">›</button>
        </div>
      ) : null}
    </section>
  );
}
