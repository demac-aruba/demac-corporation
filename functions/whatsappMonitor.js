'use strict';

const { getAuth } = require('firebase-admin/auth');
const { applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { createMessagingMonitor } = require('./whatsappMonitorService');
const { createMonitorCloud } = require('./whatsappMonitorCloud');
let service;let cloudPromise;
async function cloud() {
  if(!cloudPromise)cloudPromise=getStorage().bucket().storage.getProjectId().then(projectId=>createMonitorCloud({projectId,getToken:async()=>(await applicationDefault().getAccessToken()).access_token})).catch(error=>{cloudPromise=null;throw error;});
  return cloudPromise;
}
function monitor() {
  return service ||= createMessagingMonitor({db:getFirestore(),verifyIdToken:(token,revoked)=>getAuth().verifyIdToken(token,revoked),
    timestamp:Timestamp.fromMillis,enabled:process.env.WHATSAPP_MONITOR_ENABLED==='true',
    readTransport:async at=>(await cloud()).readTransport(at),publishSignals:async value=>(await cloud()).publishSignals(value)});
}
const options={region:'us-central1',memory:'256MiB',maxInstances:3};
exports.whatsappMessagingMonitor=onRequest({...options,timeoutSeconds:30},async(req,res)=>{
  res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','POST, OPTIONS');res.set('Cache-Control','no-store');
  const result=await monitor().handle(req);
  return result.status===204?res.status(204).send(''):res.status(result.status).json(result.body);
});
exports.whatsappMessagingMonitorTick=onSchedule({...options,schedule:'every 1 minutes',timeZone:'America/Aruba',timeoutSeconds:55,retryCount:0},async()=>{
  try { const result=await monitor().run(); logger.info('WhatsApp monitor evaluation.',{monitorSignal:'messaging-monitor-v1',outcome:result.disabled?'disabled':'complete',committed:result.committed===true}); }
  catch {logger.error('WhatsApp monitor could not complete.',{monitorSignal:'messaging-monitor-v1',outcome:'failed'});throw new Error('Messaging monitoring failed; business sends unchanged.');}
});
exports.whatsappMessagingObserveOrder=onDocumentWritten({...options,document:'workOrders/{workOrderId}',timeoutSeconds:55,retry:true},async event=>{
  const before=event.data?.before;const after=event.data?.after;if(!after?.exists)return;
  try {await monitor().observeOrder({id:after.id,before:before?.exists?before.data():null,after:after.data(),sourceAtMs:after.updateTime.toMillis()});}
  catch {logger.error('WhatsApp expectation observation failed.',{monitorSignal:'messaging-observer-v1',outcome:'failed'});throw new Error('Messaging expectation observation failed.');}
});
