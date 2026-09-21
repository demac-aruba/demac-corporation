'use client';
import { useEffect, useMemo, useState } from 'react';
import { newRegistryClient } from '@/lib/projects/registry-client';
import { centralChoice } from '@/lib/projects/scheduling-choice';
import type { CentralProject, ProjectActivity, ProjectList } from '@/lib/projects/registry-types';

/** One bounded list, then two reads for the selected plan. No local fallback or polling. */
export function useSchedulingProjects(enabled: boolean, requested: boolean, uid: string, selectedId: string) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<Array<string | undefined>>([]);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<{ scope: string; value: ProjectList | null; error: string }>({ scope: '', value: null, error: '' });
  const [detail, setDetail] = useState<{ scope: string; plan: CentralProject | null; activity: ProjectActivity | null; error: string }>({ scope: '', plan: null, activity: null, error: '' });
  const scope = `${uid}:${cursor ?? ''}:${revision}`;
  const selectedScope = `${uid}:${selectedId}:${revision}`;
  const active = enabled && requested && Boolean(uid);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const controller = new AbortController();
    setList({ scope: '', value: null, error: '' });
    void (async () => {
      try {
        const result = await newRegistryClient(uid).request<ProjectList>({ action: 'list_plans', data: { limit: 20, ...(cursor ? { afterId: cursor } : {}) } }, controller.signal);
        if (result.source !== 'project_registry_v1' || !Array.isArray(result.projects) || result.projects.length > 20) throw new Error('Invalid central Project list.');
        result.projects.forEach(centralChoice);
        if (live) setList({ scope, value: result, error: '' });
      } catch (error) {
        if (live) setList({ scope, value: null, error: error instanceof Error ? error.message : 'Shared Projects could not be loaded.' });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [active, uid, cursor, revision, scope]);
  useEffect(() => {
    if (!active || !selectedId) return;
    let live = true;
    const controller = new AbortController();
    setDetail({ scope: '', plan: null, activity: null, error: '' });
    void (async () => {
      try {
        const request = newRegistryClient(uid).request;
        const [planResult, activity] = await Promise.all([
          request<{ project: CentralProject }>({ action: 'get_plan', data: { projectId: selectedId } }, controller.signal),
          request<ProjectActivity>({ action: 'get_activity', data: { projectId: selectedId } }, controller.signal),
        ]);
        const plan = planResult.project;
        centralChoice(plan);
        if (plan.id !== selectedId || activity.projectId !== selectedId || activity.projectVersion !== plan.version) throw new Error('Project changed while loading. Refresh the selected Project.');
        if (live) setDetail({ scope: selectedScope, plan, activity, error: '' });
      } catch (error) {
        if (live) setDetail({ scope: selectedScope, plan: null, activity: null, error: error instanceof Error ? error.message : 'Selected Project could not be verified.' });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [active, uid, selectedId, revision, selectedScope]);
  const currentList = active && list.scope === scope ? list : null;
  const currentDetail = active && detail.scope === selectedScope ? detail : null;
  const choices = useMemo(() => (currentList?.value?.projects ?? []).map(centralChoice), [currentList?.value]);
  const selected = useMemo(() => currentDetail?.plan ? centralChoice(currentDetail.plan) : undefined, [currentDetail?.plan]);
  return {
    choices, selected, activity: currentDetail?.activity ?? null,
    ready: Boolean(currentList), selectedReady: Boolean(currentDetail?.plan),
    error: currentDetail?.error || currentList?.error || '',
    hasNext: Boolean(currentList?.value?.nextCursor), hasPrevious: previous.length > 0,
    refresh: () => setRevision(value => value + 1),
    next: () => { if (currentList?.value?.nextCursor) { setPrevious(value => [...value, cursor]); setCursor(currentList.value.nextCursor); } },
    prev: () => { setCursor(previous.at(-1)); setPrevious(value => value.slice(0, -1)); },
  };
}
