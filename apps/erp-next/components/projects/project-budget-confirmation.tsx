'use client';

import { useEffect, useRef } from 'react';
import type { ProjectLaborBudgetSnapshot } from '@/lib/project-labor-budget';
import styles from './project-labor-budget-status.module.css';

/** This acknowledges only the displayed forecast. It grants no capacity or overtime. */
export function ProjectBudgetConfirmation({ budgets, onCancel, onContinue }: {
  budgets: Array<{ scope: string; budget: ProjectLaborBudgetSnapshot }>;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const hours = (value: number) => new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(value);
  return <dialog ref={dialog} className={styles.confirmation} aria-labelledby="project-budget-confirmation-title"
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="project-budget-confirmation-title">La reserva supera el presupuesto estimado</h2>
    {budgets.filter(({ budget }) => budget.overBudgetHoursAfter > 0).map(({ scope, budget }) =>
      <section key={scope}>
        <strong>{scope}</strong>
        <p>Presupuesto: {hours(budget.budgetHours)} h · Total previsto: {hours(budget.committedHoursAfter)} h · Exceso: {hours(budget.overBudgetHoursAfter)} h.</p>
      </section>)}
    <p>El presupuesto original se conserva. Este total es trabajo programado y registrado; esta reserva no registra trabajo ejecutado.</p>
    <p>Puedes continuar si existe disponibilidad real. Esta confirmación no autoriza horas extra.</p>
    <footer>
      <button type="button" autoFocus onClick={onCancel}>Cancelar</button>
      <button type="button" onClick={onContinue}>Sí, estoy consciente; continuar</button>
    </footer>
  </dialog>;
}
