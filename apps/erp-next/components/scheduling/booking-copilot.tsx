'use client';

import { useMemo, useState } from 'react';
import type { BookingRestriction, BookingWorkLine } from '../../lib/scheduling';
import type { CalendarDispatchJob } from '../../lib/scheduling-capacity';
import {
  defaultBookingCopilotState,
  interpretBookingCopilotMessage,
  simulateBookingCopilot,
  type BookingCopilotPlan,
  type BookingCopilotState,
} from '../../lib/booking-intelligence/copilot';
import { describeBookingConstraints } from '../../lib/booking-intelligence/constraints';
import styles from './booking-copilot.module.css';

type Props = {
  open: boolean;
  referenceDateKey: string;
  jobs: CalendarDispatchJob[];
  onClose: () => void;
  onUsePlan: (plan: BookingCopilotPlan, prefill: { workLines: BookingWorkLine[]; restriction?: BookingRestriction; sector?: string }) => void;
};

type ChatMessage = { id: string; role: 'assistant' | 'user'; text: string };

type RecognitionResultEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type RecognitionErrorEvent = { error?: string };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionConstructor = new () => RecognitionLike;

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function workSummary(state: BookingCopilotState) {
  if (!state.workLines.length) return 'Work not set';
  return state.workLines.map((line) => `${line.quantity}× ${line.presetId.replaceAll('_', ' ')}`).join(' + ');
}

function getRecognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function BookingCopilot({ open, referenceDateKey, jobs, onClose, onUsePlan }: Props) {
  const [intent, setIntent] = useState<BookingCopilotState>(() => defaultBookingCopilotState());
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'hello', role: 'assistant', text: 'Tell me what the customer needs, the Aruba area, and any date or time restriction. I will simulate the schedule without changing anything.' },
  ]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<BookingCopilotPlan | null>(null);

  const simulation = useMemo(() => simulateBookingCopilot({ state: intent, referenceDateKey, jobs, limit: 5 }), [intent, jobs, referenceDateKey]);

  if (!open) return null;

  const addAssistant = (text: string) => setMessages((current) => [...current, { id: `a-${Date.now()}-${Math.random()}`, role: 'assistant', text }].slice(-16));

  const processMessage = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: `u-${Date.now()}`, role: 'user', text }].slice(-16));
    const interpretation = interpretBookingCopilotMessage({ text, previous: intent, referenceDateKey });
    setIntent(interpretation.state);
    setPendingPlan(null);
    const nextSimulation = simulateBookingCopilot({ state: interpretation.state, referenceDateKey, jobs, limit: 5 });
    if (interpretation.resetRequested) {
      addAssistant('Simulation reset. Tell me the new service request.');
    } else if (nextSimulation.missing.length) {
      addAssistant(nextSimulation.summary);
    } else if (!nextSimulation.plans.length) {
      addAssistant(`${nextSimulation.summary} You can loosen the day/time restriction or ask me to search a wider period.`);
    } else if (interpretation.selectionRequested) {
      const best = nextSimulation.plans[0];
      setPendingPlan(best);
      addAssistant(`I found the best matching plan on ${formatDate(best.dateKey)} at ${formatTime(best.slot.start)}. Review the impact below before continuing to booking.`);
    } else {
      const best = nextSimulation.plans[0];
      addAssistant(`Best option: ${formatDate(best.dateKey)}, ${best.slot.vanId.replace('VAN-', 'Van ')}, ${formatTime(best.slot.start)}–${formatTime(best.slot.end)}. I also listed the alternatives below.`);
    }
    setInput('');
  };

  const startVoice = () => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setVoiceError('Voice recognition is not available in this browser. You can type the same request below.');
      return;
    }
    setVoiceError(null);
    const recognition = new Recognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ').trim();
      if (transcript) processMessage(transcript);
    };
    recognition.onerror = (event) => {
      setVoiceError(event.error === 'not-allowed' ? 'Microphone permission was blocked. Allow microphone access or use text.' : 'I could not understand the microphone input. Try again or use text.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const reset = () => {
    setIntent(defaultBookingCopilotState());
    setPendingPlan(null);
    setMessages([{ id: `reset-${Date.now()}`, role: 'assistant', text: 'New simulation started. What does the customer need?' }]);
    setInput('');
  };

  const confirmPlan = () => {
    if (!pendingPlan) return;
    onUsePlan(pendingPlan, {
      workLines: intent.workLines,
      restriction: simulation.request?.restriction,
      sector: intent.sector,
    });
    setPendingPlan(null);
  };

  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.panel} role="dialog" aria-modal="true" aria-label="Booking Copilot simulator">
      <header className={styles.header}>
        <div><span>Booking Intelligence · Simulation Mode</span><h2>Voice + Text Booking Copilot</h2><p>Speak naturally. The copilot interprets your request, but the deterministic ERP scheduler remains the authority for capacity, route, lunch, support and valid work spots.</p></div>
        <button type="button" className={styles.close} onClick={onClose}>×</button>
      </header>

      <div className={styles.context}>
        <span className={styles.chip}>Area: <strong>{intent.sector ?? 'Not set'}</strong></span>
        <span className={styles.chip}>Work: <strong>{workSummary(intent)}</strong></span>
        <span className={styles.chip}>Time: <strong>{describeBookingConstraints(intent.constraints)}</strong></span>
        <span className={styles.chip}>Scope: <strong>{intent.dateScope.replaceAll('_', ' ')}</strong></span>
        {intent.excludedWeekdays.length ? <span className={styles.chip}>Excluded weekdays: <strong>{intent.excludedWeekdays.join(', ')}</strong></span> : null}
      </div>

      <div className={styles.body}>
        {messages.map((message) => <div key={message.id} className={`${styles.message} ${message.role === 'user' ? styles.user : styles.assistant}`}>{message.text}</div>)}

        <div className={styles.summary}><strong>Live simulation</strong><span>{simulation.summary}</span></div>

        {simulation.plans.length ? <div className={styles.plans}>{simulation.plans.map((plan, index) => <article key={plan.id} className={`${styles.plan} ${index === 0 ? styles.best : ''} ${plan.kind === 'capacity_recovery' ? styles.recovery : ''}`}>
          <div className={styles.planTop}><span>{index === 0 ? 'BEST OPTION' : plan.kind === 'capacity_recovery' ? 'RECOVERABLE CAPACITY' : 'VALID OPTION'}</span><b>Score {plan.score}</b></div>
          <h3>{formatDate(plan.dateKey)} · {plan.slot.vanId.replace('VAN-', 'Van ')} · {formatTime(plan.slot.start)}–{formatTime(plan.slot.end)}</h3>
          <p>{plan.slot.sector}{plan.slot.supportVanId ? ` · linked support ${plan.slot.supportVanId.replace('VAN-', 'Van ')}` : ''}</p>
          <div className={styles.impact}>{plan.impact.map((item) => <span key={item}>✓ {item}</span>)}</div>
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setPendingPlan(plan)}>{plan.kind === 'capacity_recovery' ? 'Review recovery' : 'Use this option'}</button></div>
        </article>)}</div> : simulation.missing.length ? <div className={styles.empty}>The copilot is waiting for the missing booking facts. Try: “Tengo un cliente con tres aires en Noord esta semana.”</div> : <div className={styles.empty}>No valid capacity under the current constraints. Try another day, a wider period, or remove a time restriction.</div>}

        {pendingPlan ? <div className={styles.confirm}>
          <strong>{pendingPlan.kind === 'capacity_recovery' ? 'Confirm capacity recovery plan' : 'Continue with this simulated plan?'}</strong>
          <p>{formatDate(pendingPlan.dateKey)} · {pendingPlan.slot.vanId.replace('VAN-', 'Van ')} · {formatTime(pendingPlan.slot.start)}–{formatTime(pendingPlan.slot.end)}. {pendingPlan.kind === 'capacity_recovery' ? 'The support-only change will be applied first; the primary customer appointment remains unchanged.' : 'No existing appointment will be moved.'} The customer/property form will still revalidate the final booking before placing a hold.</p>
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setPendingPlan(null)}>No, keep simulating</button><button type="button" className={styles.primary} onClick={confirmPlan}>{pendingPlan.kind === 'capacity_recovery' ? 'Yes, recover & continue' : 'Yes, continue to booking'}</button></div>
        </div> : null}
      </div>

      <footer className={styles.composer}>
        {voiceError ? <div className={styles.helper}><span>{voiceError}</span></div> : null}
        <div className={styles.inputRow}>
          <textarea className={styles.input} rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); processMessage(input); } }} placeholder="Example: 3 standard services in Noord, this week, after 10 AM..." />
          <button type="button" className={`${styles.mic} ${listening ? styles.listening : ''}`} onClick={startVoice} disabled={listening} title="Speak booking request">{listening ? '●' : '🎙'}</button>
          <button type="button" className={styles.primary} onClick={() => processMessage(input)} disabled={!input.trim()}>Ask</button>
        </div>
        <div className={styles.helper}><span>Nothing changes in Scheduling until you explicitly confirm a plan.</span><button type="button" className={styles.secondary} onClick={reset}>New simulation</button></div>
      </footer>
    </aside>
  </div>;
}
