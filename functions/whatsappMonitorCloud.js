'use strict';

// Fixed Google APIs only. No user-supplied URL, no customer content or identifiers.
function createMonitorCloud({ projectId, getToken, fetchImpl = fetch }) {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('Invalid monitoring project.');
  async function post(url,body) {
    const token=await getToken();
    if(!token)throw new Error('Monitoring credentials unavailable.');
    const response=await fetchImpl(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Monitoring API unavailable.');
    return response.status===204?{}:response.json();
  }
  async function readTransport(at) {
    const base=`resource.type="cloud_run_revision" resource.labels.service_name="waclioutboundpoll" jsonPayload.monitorSignal="wacli-poll-v1" timestamp>="${new Date(at-30*60000).toISOString()}" timestamp<="${new Date(at+60000).toISOString()}"`;
    const read=async outcome=>{
      const data=await post('https://logging.googleapis.com/v2/entries:list',{resourceNames:[`projects/${projectId}`],filter:`${base} jsonPayload.outcome="${outcome}"`,orderBy:'timestamp desc',pageSize:1});
      return Date.parse(data.entries?.[0]?.timestamp || '') || null;
    };
    const [lastSuccessAtMs,lastErrorAtMs]=await Promise.all([read('ok'),read('error')]);
    return {available:true,lastSuccessAtMs,lastErrorAtMs};
  }
  async function publishSignals(snapshot) {
    const values={heartbeat:1,critical_incidents:snapshot.incidents.filter(x=>['critical','unknown'].includes(x.severity)).length,
      warning_incidents:snapshot.incidents.filter(x=>x.severity==='warning').length};
    const timeSeries=Object.entries(values).map(([name,value])=>({metric:{type:`custom.googleapis.com/demac/messaging/${name}`},
      resource:{type:'global',labels:{project_id:projectId}},metricKind:'GAUGE',valueType:'INT64',
      points:[{interval:{endTime:new Date(snapshot.evaluatedAtMs).toISOString()},value:{int64Value:String(value)}}]}));
    await post(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`,{timeSeries});
  }
  return {readTransport,publishSignals};
}
module.exports={createMonitorCloud};
