# DEMAC Communication Center V8 — Consolidated Acceptance Checklist

This checklist is the implementation contract for the consolidated Communication Center pass. It intentionally separates UI acceptance from transport activation so individual fixes are not lost between iterations.

## Workspace / visual
- Communication Center remains a dedicated full-screen browser workspace with no ERP sidebar.
- Preserve the three-column operator layout: Inbox / active conversation / Customer 360.
- Premium WhatsApp-Web-like visual hierarchy, readable typography, soft borders/shadows and comfortable spacing.
- Chat canvas uses a dense, low-contrast doodle/watermark pattern rather than a flat cream background.
- No nested/split-chat CSS bug; the message stream owns the full center conversation canvas.
- Inbox keeps semantic states: overdue/escalated red, needs-reply amber, assigned/in-progress green, unassigned neutral, resolved muted.
- Preserve Needs reply / Mine / Unassigned / All team, search and queue filtering.
- Approved Service Reports remain outside Communications under Reports.

## Composer / keyboard UX
- No permanent text Send button.
- Enter sends; Shift+Enter inserts a newline.
- Textarea immediately regains/retains focus after a successful send so the operator can continue typing.
- Remove the browser-like blue rectangular focus ring; use a subtle natural focus state.
- Plus button sits on the left and opens Document plus Photos/Videos choices.
- Microphone sits on the far right and uses a recognizable microphone icon.
- Voice recording supports start / stop / cancel and sends a true WhatsApp voice note after backend activation.

## Rich WhatsApp messages
- Preserve Unicode/emoji end-to-end.
- Images render inline with thumbnail and full-size open behavior.
- Stickers render without a normal text bubble and preserve transparency.
- Audio/voice notes render with a playable audio control.
- Video renders with browser playback controls.
- Documents/PDFs render as file cards with filename and open/download action.
- Media captions stay attached to the corresponding media message.
- Outbound operator media supports photos, videos, documents/PDFs and voice notes.

## Contact identity / CRM matching
- Inbox and selected-chat header show the WhatsApp profile picture when available; initials are fallback only.
- Selected contact always shows a real canonical phone when WhatsApp makes it resolvable.
- Never display numeric @lid identifiers as telephone numbers.
- Persist WhatsApp LID separately from canonical phone/JID.
- Identity states: resolved, resolving, unavailable.
- Canonical flow: WhatsApp identity -> canonical phone -> normalized phone -> CRM exact match -> existing DEMAC customer or new/unregistered contact.
- Never auto-create a CRM customer using a LID value as the telephone number.

## Customer 360
- Show name, canonical phone, email, CRM status/type, properties and registered A/C count/list.
- Clearly label Existing DEMAC Customer vs New / unregistered WhatsApp contact.
- Quick actions use the ERP's canonical flows: Create Appointment, Warranty Ticket, Add A/C, Edit Customer, Open CRM.
- No unexplained empty reserved panel and no fake operational action that silently does nothing.

## Multi-operator / audit
- ERP-originated text and media record the authenticated operator user ID and display name.
- Internal history shows Christian/Yerika/etc., not generic DEMAC, for ERP-originated sends.
- Messages sent from another linked WhatsApp device remain labelled Linked WhatsApp device when no ERP operator attribution exists.
- Preserve ownership/takeover/reassignment, status, unread handling, internal notes and collision controls.

## Durable media / identity architecture
- wacli follow sync enables bounded media download.
- Bridge enriches flat wacli message webhooks from the local store instead of assuming every event is text.
- Incoming media is copied to private Firebase Storage and referenced from Firestore by storage path + MIME/type metadata.
- Browser reads private communication media with authenticated Firebase credentials; no public media bucket.
- Outbound browser media uploads to a user-scoped private Storage path, then queues a provider-neutral Firestore outbound item.
- Firebase creates short-lived signed read URLs for the trusted bridge; the bridge downloads only approved HTTPS signed URLs and sends through wacli.
- Voice notes are converted to OGG/Opus when needed and sent using wacli voice/PTT semantics.
- Profile pictures are fetched through wacli, cached privately and refreshed rather than hot-linking an expiring CDN URL forever.
- Bridge attempts LID -> phone resolution from wacli's local identity/message mapping; unresolved identities remain safely unresolved rather than being mislabelled as phone numbers.

## Activation safety
- Continue using the personal linked-device test environment until acceptance is complete.
- Do not pair the official DEMAC WhatsApp number during this pass.
- Keep text messaging backwards-compatible while media/identity enrichment is rolled out.
- No PR / merge from this preview branch until the consolidated preview has been reviewed.
