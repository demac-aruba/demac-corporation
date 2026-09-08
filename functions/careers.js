'use strict';
const {getApps,initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {getStorage}=require('firebase-admin/storage');
const {onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createService}=require('./careers/service');
const {createFiles}=require('./careers/files');
const {createInfrastructure}=require('./careers/infrastructure');
const {createHandler}=require('./careers/http');
const {createWorkers}=require('./careers/workers');
if(!getApps().length)initializeApp();
let runtime;
function getRuntime(){
  if(runtime)return runtime;
  const db=getFirestore(),infrastructure=createInfrastructure(process.env,require('nodemailer').createTransport);
  const files=createFiles({bucket:getStorage().bucket(),sharp:require('sharp'),scanner:infrastructure.scanner});
  const service=createService({db,files,infrastructure});
  runtime={service,workers:createWorkers({db,files,infrastructure})};return runtime;
}
const options={region:'us-central1',timeoutSeconds:90,memory:'512MiB',maxInstances:3,concurrency:1,secrets:['CAREERS_SMTP_PASSWORD','CAREERS_RATE_SALT'],...(process.env.CAREERS_VPC_CONNECTOR?{vpcConnector:process.env.CAREERS_VPC_CONNECTOR,vpcConnectorEgressSettings:'PRIVATE_RANGES_ONLY'}:{})};
exports.careersAdmin=onRequest(options,(req,res)=>createHandler({service:getRuntime().service,auth:getAuth(),env:process.env,admin:true})(req,res));
exports.careersPublic=onRequest(options,(req,res)=>createHandler({service:getRuntime().service,auth:getAuth(),env:process.env})(req,res));
exports.careersMaintenance=onSchedule({...options,schedule:'every 5 minutes',timeZone:'America/Aruba'},async()=>{
  if(process.env.DEMAC_CAREERS_BACKEND_ENABLED!=='true' || process.env.CAREERS_RELEASE_APPROVED!=='true')return;
  const {workers}=getRuntime();await workers.emailTick();
  if(process.env.CAREERS_RETENTION_APPROVED==='true')await workers.cleanup();
});
