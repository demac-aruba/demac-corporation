# DEMAC ERP Next — Communication Center & AI Customer Agent V1

Status: In Development / preview-domain foundation.

## Objective
Create one DEMAC customer conversation across WhatsApp, calls, phone and internal handoffs, while using AI for the normal path and humans for exceptions.

## Requirements

- COM-001: Conversation context belongs to the customer/conversation, not to a browser tab or individual operator.
- COM-002: Each active conversation has status, queue, owner, next action and due date.
- COM-003: Shared inbox supports assignment, takeover, operator presence and collision/reply locking.
- COM-004: Internal Note is structurally distinct from Reply to Customer.
- COM-005: Stale AI/operator drafts must be invalidated when another operator sends first.
- COM-006: Customer context includes CRM identity, property, equipment, open work, invoices/payments and recent history as permitted.
- COM-007: Quick actions include appointment, lead, estimate, customer/property, payment issue, escalation, complaint and follow-up.
- COM-008: Routing may use language, queue expertise, load, VIP/commercial status and operator availability.
- COM-009: Operator voice presence is shared across ordinary phone and WhatsApp voice so one operator is not offered two simultaneous voice calls.
- COM-010: Shift handoff retains context and next action.

- AI-CS-001: AI handles routine low-risk customer service using governed ERP tools.
- AI-CS-002: AI never invents schedule availability; it calls deterministic Scheduling logic.
- AI-CS-003: AI asks only for missing information and retains already known customer restrictions.
- AI-CS-004: Rejected appointment options are not repeated unless the underlying constraint changes.
- AI-CS-005: Complaints, damage/compensation, refunds, payment disputes, complex technical work, pricing exceptions, anger/high risk and low confidence escalate to human ownership.
- AI-CS-006: Handoff summary includes customer, property, request, restrictions, rejected options, recent work/payment context, sentiment, actions already taken, escalation reason and recommended next action.
- AI-CS-007: Customer must not be required to repeat the story after human handoff.
- AI-CS-008: AI role is permission-scoped and cannot change pricing, issue refunds/write-offs, delete records or perform accounting/employee/inventory administration outside approved tools.
- AI-CS-009: AI learning is based on approved policies and corrected workflows, not blind imitation of operator behavior.
- AI-CS-010: KPIs include response time, booking/estimate conversion, AI resolution %, transfer %, correction rate, escalations, reopen rate and revenue attribution.

## Voice/contact-center continuation

The same conversation/ownership model is designed to accept WhatsApp Business Calling and ordinary PBX/SIP calls later. Voice calls should screen-pop Customer 360, log duration/outcome and preserve chat-to-voice context.

## Integration scope

Preview state only. No Meta WhatsApp writes, calling API, SIP/PBX, Firebase persistence or production OpenAI agent tool calls are enabled yet.
