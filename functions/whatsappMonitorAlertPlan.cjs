'use strict';
// Generates reviewable policy documents only. No API calls, credentials, or writes to production.
function alertPlan(project,channels){
  if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)||!Array.isArray(channels)||!channels.length||channels.some(value=>!new RegExp(`^projects/${project}/notificationChannels/[0-9]+$`).test(value)))throw Error('Supply a project and its verified notification channel resource names.');
  const base={enabled:true,combiner:'OR',notificationChannels:channels,documentation:{mimeType:'text/markdown',content:'Revisar DEMAC ERP → Monitor de mensajería. No reenviar mensajes históricos ni repetir un envío sin conciliar el resultado.'}};
  const metric=name=>`resource.type="global" AND metric.type="custom.googleapis.com/demac/messaging/${name}"`;
  return [
    ...[['critical_incidents','Fallo de mensajería','60s'],['warning_incidents','Demora de mensajería','120s']].map(([name,label,duration])=>({...base,displayName:`DEMAC · ${label}`,conditions:[{displayName:label,conditionThreshold:{filter:metric(name),comparison:'COMPARISON_GT',thresholdValue:0,duration,aggregations:[{alignmentPeriod:'60s',perSeriesAligner:'ALIGN_MAX'}],trigger:{count:1}}}],alertStrategy:{autoClose:'1800s'}})),
    {...base,displayName:'DEMAC · Monitor sin comprobaciones',conditions:[{displayName:'Sin señal durante 5 minutos',conditionAbsent:{filter:metric('heartbeat'),duration:'300s',aggregations:[{alignmentPeriod:'60s',perSeriesAligner:'ALIGN_MAX'}],trigger:{count:1}}}],alertStrategy:{autoClose:'1800s'}},
    {...base,displayName:'DEMAC · Error del monitor o del observador',conditions:[{displayName:'Error interno de supervisión',conditionMatchedLog:{filter:'resource.type="cloud_run_revision" severity>=ERROR (jsonPayload.monitorSignal="messaging-monitor-v1" OR jsonPayload.monitorSignal="messaging-observer-v1")'}}],alertStrategy:{notificationRateLimit:{period:'900s'},autoClose:'1800s'}},
  ];
}
if(require.main===module)console.log(JSON.stringify(alertPlan(process.argv[2],process.argv.slice(3)),null,2));
module.exports={alertPlan};
