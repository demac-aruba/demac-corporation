'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadBrowserWorkforce, previewWorkforceSeed, saveBrowserWorkforce, workforceSkills, type BrowserWorkforceEmployee, type WorkforceSkill } from '../../lib/browser-workforce';
import styles from './browser-workforce-registry.module.css';

const vanOptions = ['VAN-1', 'VAN-2', 'VAN-3', 'VAN-4', 'UNASSIGNED'];

export function BrowserWorkforceRegistry() {
  const [roster, setRoster] = useState<BrowserWorkforceEmployee[]>([]);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setRoster(loadBrowserWorkforce());
    setReady(true);
  }, []);

  const metrics = useMemo(() => ({
    active: roster.filter((employee) => employee.active).length,
    verified: roster.filter((employee) => employee.active && employee.skillsVerified).length,
    unverified: roster.filter((employee) => employee.active && !employee.skillsVerified).length,
    vans: new Set(roster.filter((employee) => employee.active && employee.vanId !== 'UNASSIGNED').map((employee) => employee.vanId)).size,
  }), [roster]);

  const patch = (id: string, update: Partial<BrowserWorkforceEmployee>) => {
    setRoster((current) => current.map((employee) => employee.id === id ? { ...employee, ...update } : employee));
    setDirty(true);
    setNotice(null);
  };

  const toggleSkill = (employee: BrowserWorkforceEmployee, skill: WorkforceSkill) => {
    const skills = employee.skills.includes(skill) ? employee.skills.filter((value) => value !== skill) : [...employee.skills, skill];
    patch(employee.id, { skills, skillsVerified: false });
  };

  const save = () => {
    const saved = saveBrowserWorkforce(roster);
    setRoster(saved);
    setDirty(false);
    setNotice('Workforce Registry saved. Consolidated Job Readiness now recalculates Crew & Required Skill from these records.');
  };

  const addEmployee = () => {
    const id = `EMP-NEW-${Date.now().toString().slice(-8)}`;
    setRoster((current) => [...current, { id, name: 'New Employee', role: 'HVAC Technician', vanId: 'UNASSIGNED', active: true, skills: [], skillsVerified: false, source: 'operator', updatedAt: new Date().toISOString() }]);
    setDirty(true);
  };

  const resetSeed = () => {
    setRoster(previewWorkforceSeed());
    setDirty(true);
    setNotice('Preview seed restored in memory. Press Save Registry to make it the current browser workforce state.');
  };

  if (!ready) return <section className={styles.loading}>Loading workforce registry…</section>;

  return (
    <section className={styles.workspace}>
      <header><div><span>LIVE WORKFORCE REGISTRY · PREVIEW</span><h2>Crew & Skill Configuration</h2><p>Work Order readiness uses verified skills from the crew assigned to each van. Unverified profiles create AT RISK—not false READY.</p></div><div className={styles.actions}><button type="button" onClick={resetSeed}>Reset Preview Seed</button><button type="button" onClick={addEmployee}>+ Employee</button><button className={styles.primary} disabled={!dirty} type="button" onClick={save}>{dirty ? 'Save Registry' : 'Saved'}</button></div></header>

      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.metrics}><article><span>Active Field Staff</span><strong>{metrics.active}</strong><small>Included in crew resolution</small></article><article><span>Verified Skill Profiles</span><strong>{metrics.verified}</strong><small>Can produce READY evidence</small></article><article><span>Unverified Profiles</span><strong>{metrics.unverified}</strong><small>Remain AT RISK until reviewed</small></article><article><span>Vans With Active Crew</span><strong>{metrics.vans}/4</strong><small>Current browser roster</small></article></div>

      <div className={styles.tableWrap}>
        <div className={`${styles.row} ${styles.head}`}><span>Employee</span><span>Van</span><span>Skills</span><span>Verification</span><span>Status</span></div>
        {roster.map((employee) => <div className={styles.row} key={employee.id}>
          <div className={styles.identity}><input value={employee.name} onChange={(event) => patch(employee.id, { name: event.target.value, skillsVerified: false })} /><input className={styles.role} value={employee.role} onChange={(event) => patch(employee.id, { role: event.target.value })} /><small>{employee.id} · {employee.source === 'preview_seed' ? 'Preview seed' : 'Operator maintained'}</small></div>
          <select value={employee.vanId} onChange={(event) => patch(employee.id, { vanId: event.target.value, skillsVerified: false })}>{vanOptions.map((van) => <option value={van} key={van}>{van}</option>)}</select>
          <div className={styles.skills}>{workforceSkills.map((skill) => <button type="button" key={skill} className={employee.skills.includes(skill) ? styles.skillActive : ''} onClick={() => toggleSkill(employee, skill)}>{employee.skills.includes(skill) ? '✓ ' : ''}{skill}</button>)}</div>
          <label className={styles.check}><input type="checkbox" checked={employee.skillsVerified} onChange={(event) => patch(employee.id, { skillsVerified: event.target.checked })} /><span>{employee.skillsVerified ? 'Verified' : 'Needs review'}</span></label>
          <label className={styles.check}><input type="checkbox" checked={employee.active} onChange={(event) => patch(employee.id, { active: event.target.checked, skillsVerified: event.target.checked ? employee.skillsVerified : false })} /><span>{employee.active ? 'Active' : 'Inactive'}</span></label>
        </div>)}
      </div>

      <footer><span>READINESS RULE</span><strong>Verified required skill on every assigned van → READY. Unverified coverage → AT RISK. Verified crew with missing required skill, or no active crew on an assigned van → BLOCKED.</strong></footer>
    </section>
  );
}
