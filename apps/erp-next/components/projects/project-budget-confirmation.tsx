'use client';

import { useEffect, useRef } from 'react';
import type { ProjectLaborBudgetSnapshot } from '@/lib/project-labor-budget';
import { projectSlotLabel } from '@/lib/project-slot-label';
import styles from './project-labor-budget-status.module.css';

/** This acknowledges only the displayed forecast. It grants no capacity or overtime. */
export function ProjectBudgetConfirmation({ budgets, slotDurationMinutes, onCancel, onContinue }: {
  budgets: Array<{ scope: string; budget: ProjectLaborBudgetSnapshot }>;
  slotDurationMinutes: number;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const slots = (value: number) => projectSlotLabel(value, slotDurationMinutes, 'es');
  return <dialog ref={dialog} className={styles.confirmation} aria-labelledby="project-budget-confirmation-title"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="project-budget-confirmation-title">La reserva supera el presupuesto estimado</h2>
    {budgets.filter(({ budget }) => budget.overBudgetHoursAfter > 0).map(({ scope, budget }) =>
      <section key={scope}>
        <strong>{scope}</strong>
        <p>Presupuesto: {slots(budget.budgetHours)} · Total previsto: {slots(budget.committedHoursAfter)} · Exceso: {slots(budget.overBudgetHoursAfter)}.</p>
      </section>)}
    <p>El presupuesto original se conserva. El total incluye los slots programados y el consumo ya registrado; esta reserva no registra trabajo ejecutado.</p>
    <p>Puedes continuar si existe disponibilidad real. La autorización de overtime se mantiene separada.</p>
    <footer>
      <button type="button" autoFocus onClick={onCancel}>Cancelar</button>
      <button type="button" onClick={onContinue}>Sí, estoy consciente; continuar</button>
    </footer>
  </dialog>;
}
