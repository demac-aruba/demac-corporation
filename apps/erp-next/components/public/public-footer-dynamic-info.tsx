'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadPublishedWebsiteContent } from '@/lib/public-website-public';
import { defaultPublicWebsiteContent, type PublicWebsiteContent } from '@/lib/public-website-content';

export function PublicFooterDynamicInfo() {
  const [content, setContent] = useState<PublicWebsiteContent>(defaultPublicWebsiteContent);

  useEffect(() => {
    let cancelled = false;
    void loadPublishedWebsiteContent().then((next) => {
      if (!cancelled) setContent(next);
    });
    return () => { cancelled = true; };
  }, []);

  const contact = content.contact;
  const whatsappHref = contact.whatsappUrl || '/contact?channel=whatsapp';

  return (
    <section className="premium-footer-contact">
      <strong>Contact DEMAC</strong>
      <div className="premium-footer-contact-item">
        <span aria-hidden="true">⌖</span>
        <div><small>Office</small><b>{contact.officeAddress}</b><em>Aruba</em></div>
      </div>
      <div className="premium-footer-contact-item">
        <span aria-hidden="true">◷</span>
        <div><small>Business Hours</small><b>{contact.weekdayHours}</b><em>{contact.saturdayHours}</em></div>
      </div>
      {contact.phone ? <div className="premium-footer-contact-item"><span aria-hidden="true">☎</span><div><small>Phone</small><b>{contact.phone}</b></div></div> : null}
      {contact.email ? <div className="premium-footer-contact-item"><span aria-hidden="true">✉</span><div><small>Email</small><b>{contact.email}</b></div></div> : null}
      <div className="premium-footer-contact-actions">
        {whatsappHref.startsWith('http') ? <a href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp / Contact</a> : <Link href={whatsappHref}>WhatsApp / Contact</Link>}
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.officeAddress.replace('·', ','))}`} target="_blank" rel="noreferrer">Get Directions ↗</a>
      </div>
      {(contact.facebookUrl || contact.instagramUrl) ? <div className="premium-footer-social-links">{contact.facebookUrl ? <a href={contact.facebookUrl} target="_blank" rel="noreferrer">Facebook ↗</a> : null}{contact.instagramUrl ? <a href={contact.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a> : null}</div> : null}
    </section>
  );
}
