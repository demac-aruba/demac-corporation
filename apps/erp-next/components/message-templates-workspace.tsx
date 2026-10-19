'use client';
import { useMemo } from 'react';
import { useAuth } from './auth/auth-provider';
import { messageTemplateApi } from '@/lib/firebase/message-templates';
import { MessageTemplatesEditor } from './message-templates-editor';
export function MessageTemplatesWorkspace() {
  const { principal } = useAuth();
  const api = useMemo(() => messageTemplateApi(principal.userId), [principal.userId]);
  if (!principal.active || principal.role !== 'super_admin') return <p>Administrator access is required.</p>;
  return <MessageTemplatesEditor key={principal.userId} api={api} />;
}
