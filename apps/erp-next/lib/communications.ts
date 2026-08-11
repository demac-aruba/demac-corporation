export type Channel = 'whatsapp' | 'phone' | 'whatsapp_call' | 'email' | 'internal';
export type ConversationStatus = 'new' | 'assigned' | 'waiting_customer' | 'waiting_demac' | 'appointment_pending' | 'estimate_pending' | 'payment_pending' | 'escalated' | 'resolved' | 'closed';
export type Queue = 'general' | 'scheduling' | 'sales' | 'finance' | 'technical' | 'commercial_vip' | 'complaints' | 'manager';
export type OperatorPresence = 'available' | 'on_call' | 'after_call' | 'away' | 'offline';
export type AiDisposition = 'ai_active' | 'human_active' | 'handoff_pending' | 'ai_paused';

export type ConversationMessage = {
  id: string;
  at: string;
  author: string;
  role: 'customer' | 'operator' | 'ai' | 'system' | 'internal_note';
  text: string;
  channel: Channel;
};

export type Conversation = {
  id: string;
  customerId?: string;
  customer: string;
  phone: string;
  language: 'Papiamento' | 'English' | 'Spanish' | 'Dutch';
  property?: string;
  equipment?: string;
  status: ConversationStatus;
  queue: Queue;
  owner?: string;
  aiDisposition: AiDisposition;
  nextAction?: string;
  nextActionDue?: string;
  vip: boolean;
  unread: number;
  lockedBy?: string;
  lastActivityAt: string;
  messages: ConversationMessage[];
};

export type Operator = {
  id: string;
  name: string;
  presence: OperatorPresence;
  activeChats: number;
  activeVoiceCall?: string;
  languages: Array<'Papiamento' | 'English' | 'Spanish' | 'Dutch'>;
  queues: Queue[];
};

export type AiHandoff = {
  conversationId: string;
  customer: string;
  property?: string;
  reason: string;
  request: string;
  restrictions: string[];
  rejectedOptions: string[];
  paymentContext?: string;
  sentiment: 'calm' | 'frustrated' | 'angry' | 'urgent';
  actionsAlreadyTaken: string[];
  recommendedNextAction: string;
};

export const previewOperators: Operator[] = [
  { id: 'OP-1', name: 'Yerika', presence: 'available', activeChats: 3, languages: ['Papiamento','Spanish','English'], queues: ['general','scheduling','sales'] },
  { id: 'OP-2', name: 'Office 2', presence: 'on_call', activeChats: 2, activeVoiceCall: 'CALL-991', languages: ['Papiamento','English'], queues: ['general','finance'] },
  { id: 'OP-3', name: 'Operations', presence: 'available', activeChats: 1, languages: ['Spanish','English','Papiamento'], queues: ['technical','complaints','manager'] },
];

export const previewConversations: Conversation[] = [
  { id: 'CONV-1001', customerId: 'C-0887', customer: 'John Smith', phone: '+297 560 1188', language: 'English', property: 'Noord Residence', equipment: '7 HVAC assets', status: 'appointment_pending', queue: 'scheduling', owner: 'Yerika', aiDisposition: 'ai_active', nextAction: 'Offer valid slots after 10 AM', nextActionDue: 'Today 10:45', vip: false, unread: 1, lastActivityAt: '10:31', messages: [
    { id: 'M1', at: '10:22', author: 'Customer', role: 'customer', text: 'Hi, I need service for two air conditioners. I can only be home after 10.', channel: 'whatsapp' },
    { id: 'M2', at: '10:23', author: 'DEMAC AI', role: 'ai', text: 'I found your Noord property and the registered equipment. I am checking the DEMAC schedule for options after 10:00 AM.', channel: 'whatsapp' },
    { id: 'M3', at: '10:31', author: 'System', role: 'system', text: 'Availability recalculated. Previously rejected options are excluded.', channel: 'internal' },
  ] },
  { id: 'CONV-1002', customerId: 'C-1201', customer: 'Ocean View Villas', phone: '+297 586 9912', language: 'English', property: 'Palm Beach Property', status: 'payment_pending', queue: 'finance', owner: 'Office 2', aiDisposition: 'human_active', nextAction: 'Confirm allocation and remaining Afl. 1,000', nextActionDue: 'Today 11:15', vip: true, unread: 0, lastActivityAt: '10:05', messages: [
    { id: 'M1', at: '09:48', author: 'Customer', role: 'customer', text: 'We transferred Afl. 13,000 this morning.', channel: 'whatsapp' },
    { id: 'M2', at: '09:52', author: 'System', role: 'system', text: 'Banking Monitor detected Afl. 13,000 and matched invoices 2108 + 2114. Afl. 1,000 remains open.', channel: 'internal' },
  ] },
  { id: 'CONV-1003', customerId: 'C-1042', customer: 'ABC Aruba N.V.', phone: '+297 582 4410', language: 'English', property: 'Oranjestad Office', status: 'estimate_pending', queue: 'sales', owner: 'Yerika', aiDisposition: 'human_active', nextAction: 'Follow up proposal #2187', nextActionDue: 'Today 14:00', vip: true, unread: 2, lastActivityAt: '09:44', messages: [
    { id: 'M1', at: '09:40', author: 'Customer', role: 'customer', text: 'Can you update the proposal with anti-corrosive coating?', channel: 'whatsapp' },
  ] },
  { id: 'CONV-1004', customerId: 'C-0741', customer: 'Maria Croes', phone: '+297 561 7732', language: 'Papiamento', property: 'Santa Cruz Home', status: 'escalated', queue: 'complaints', owner: 'Operations', aiDisposition: 'human_active', nextAction: 'Manager review of repeat cooling complaint', nextActionDue: 'Now', vip: false, unread: 3, lastActivityAt: '10:33', messages: [
    { id: 'M1', at: '10:18', author: 'Customer', role: 'customer', text: 'E airco no ta fria bon despues di e ultimo servicio.', channel: 'whatsapp' },
    { id: 'M2', at: '10:19', author: 'DEMAC AI', role: 'ai', text: 'Mi ta pasa e caso aki pa nos team tecnico cu tur e informacion di e ultimo servicio.', channel: 'whatsapp' },
  ] },
];

export const previewHandoff: AiHandoff = {
  conversationId: 'CONV-1004', customer: 'Maria Croes', property: 'Santa Cruz Home', reason: 'Repeat complaint after recent service', request: 'Air conditioner is not cooling properly after last service', restrictions: [], rejectedOptions: [], sentiment: 'frustrated', actionsAlreadyTaken: ['Customer identified', 'Property and equipment history loaded', 'Recent Work Order located', 'AI acknowledged complaint without assigning blame'], recommendedNextAction: 'Human technical review and callback; open recent Work Order and equipment service history.',
};

export function canOfferVoiceConversation(operator: Operator) {
  return operator.presence === 'available' && !operator.activeVoiceCall;
}

export function routeConversation(conversation: Conversation, operators: Operator[]) {
  const candidates = operators.filter((operator) => operator.presence === 'available' && operator.queues.includes(conversation.queue) && operator.languages.includes(conversation.language));
  return [...candidates].sort((a, b) => a.activeChats - b.activeChats)[0];
}

export function aiRiskDecision(args: { intent: string; complaint: boolean; paymentDispute: boolean; refund: boolean; pricingException: boolean; technicalComplexity: 'normal' | 'complex'; confidence: number }) {
  if (args.complaint || args.paymentDispute || args.refund || args.pricingException || args.technicalComplexity === 'complex' || args.confidence < 0.72) return { mode: 'human' as const, reason: 'Exception/high-risk conversation requires human ownership' };
  return { mode: 'ai' as const, reason: 'Routine low-risk path may continue with governed tools' };
}
