import { callOfficeBookingAuthority, createOfficeLifecycleRequestId } from './office-booking-authority';

export type AlertContext = { customerId?: string; propertyId?: string; dwellingId?: string; query?: string };
export type CustomerAlert = {
  id: string; customerId: string; customerName: string; propertyId: string; dwellingId: string;
  phone: string; address: string; category: 'debt' | 'conduct' | 'other'; comment: string;
  status: 'active' | 'resolved' | 'invalidated'; version: number; createdAt: string;
  createdBy: { id: string; name: string }; updatedAt: string;
};
export type AlertMatch = CustomerAlert & { matchKind: 'customer' | 'phone' | 'address'; canDismiss: boolean };
export type AlertMatches = { success: true; matches: AlertMatch[]; contextToken: string; customerName: string };
export type AlertList = {
  success: true; customer: { id: string; name: string; phone: string }; alerts: CustomerAlert[];
  properties: { id: string; name: string; address: string; hasIndependentDwellings: boolean }[];
};
export type AlertEvent = { id: string; action: string; at: string; actor: { name: string }; reason?: string; decision?: string; after?: CustomerAlert; customerId?: string };
export const alertCategoryLabels = { debt: 'Deuda pendiente', conduct: 'Trato al personal', other: 'Otra situación' };
export const alertStatusLabels = { active: 'Activa', resolved: 'Resuelta', invalidated: 'Invalidada' };
export const listCustomerAlerts = (customerId: string) => callOfficeBookingAuthority<AlertList>('list_customer_alerts', { customerId });
export const matchCustomerAlerts = (context: AlertContext) => callOfficeBookingAuthority<AlertMatches>('match_customer_alerts', context);
export const mutateCustomerAlert = (action: string, data: Record<string, unknown>) => callOfficeBookingAuthority<{ success: true; alert: CustomerAlert }>(action, data);
export const newAlertRequestId = () => createOfficeLifecycleRequestId('customer-alert');
export const customerAlertHistory = (id: string) => callOfficeBookingAuthority<{ success: true; events: AlertEvent[]; limit: number }>('customer_alert_history', { id });
export const alertDate = (value: string) => new Date(value).toLocaleString('es', { timeZone: 'America/Aruba', dateStyle: 'medium', timeStyle: 'short' });
