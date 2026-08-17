# Communication Center engineering invariants

This connector intentionally keeps one transport architecture while DEMAC uses the temporary wacli channel.

- The DigitalOcean bridge listens only on localhost and initiates all Firebase traffic outbound.
- wacli webhooks are authenticated with native HMAC; bridge-to-Firebase requests use the existing Bearer boundary.
- Customer media and browser-recorded voice notes use the same authenticated Firebase upload and outbound queue.
- Browser uploads require an active DEMAC operations-role profile and never receive bridge credentials.
- Inbound webhook events are durable. Systemic Firebase failures remain queued; an isolated irrecoverable event is retained in the dead-letter directory after bounded retries so later customer traffic can continue.
- Voice notes are normalized to OGG/Opus on the bridge and sent with `wacli send voice`.
- `/v1/send` and `/v1/media` remain retired; Firebase never calls back into the Droplet.

The deployment gates verify the private bridge surface, canonical store, Firebase polling, empty active outbox/ACK queues, and availability of ffmpeg for voice normalization.
