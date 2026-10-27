// Existing isolated workflow probes have no synthetic incidents. The complete alert
// UI -> real facade -> transactional data flow is covered by customer-alerts-browser.cjs.
module.exports = `
export const alertCategoryLabels={debt:'Deuda pendiente',conduct:'Trato al personal',other:'Otra situación'};
export const alertStatusLabels={active:'Activa',resolved:'Resuelta',invalidated:'Invalidada'};
export const alertDate=value=>value;
export const newAlertRequestId=()=>crypto.randomUUID();
export async function listCustomerAlerts(customerId){return {success:true,customer:{id:customerId,name:'Synthetic customer',phone:''},alerts:[],properties:[]};}
export async function matchCustomerAlerts(){return {success:true,matches:window.__customerAlert?[window.__customerAlert]:[],contextToken:'synthetic-empty',customerName:'Synthetic customer'};}
export async function mutateCustomerAlert(action,data){if(window.__customerAlert&&action==='review_customer_alert'){(window.__alertDecisions ||= []).push(data);return {success:true};}throw Error('Unexpected incident mutation in a non-alert scenario');}
export async function customerAlertHistory(){return {success:true,events:[],limit:50};}
`;
