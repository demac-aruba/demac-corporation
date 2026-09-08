'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
if(process.env.GCLOUD_PROJECT!=='demo-demac-careers'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST||''))throw Error('Local demo emulators required; production is forbidden.');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getStorage}=require('firebase-admin/storage');
const {createService,COLLECTIONS:N}=require('./service'),{createFiles}=require('./files'),{createWorkers}=require('./workers'),sharp=require('sharp');
const {removePrivateObject}=require('./object-deletion');
test('storage acknowledgement loss retains cleanup intent and never deletes adopted application bytes',async()=>{
  const app=initializeApp({projectId:'demo-demac-careers',storageBucket:'demo-demac-careers.appspot.com'},'orphan-review'),db=getFirestore(app),bucket=getStorage(app).bucket();let time=Date.now();
  const files=createFiles({bucket,sharp,scanner:async()=>{}}),infrastructure={blockers:()=>[],signature:()=> 'qa-test'};
  const service=createService({db,files,infrastructure,now:()=>time}),workers=createWorkers({db,files,infrastructure,now:()=>time});
  const token='a'.repeat(64),C=require('./core'),id=crypto.randomUUID();
  try{
    await db.collection(N.sessions).doc(id).set({id,files:{},status:'draft',secretHash:C.digest(token),expiresAt:time+86400000});
    const photo=await sharp({create:{width:64,height:64,channels:3,background:'#eee'}}).png().toBuffer();
    const failing=createService({db,files:{...files,store:async(...params)=>{await files.store(...params);throw Error('Simulated lost storage acknowledgement');}},infrastructure,now:()=>time});
    await assert.rejects(failing.upload({sessionId:id,token,kind:'photo',name:'qa.png',base64:photo.toString('base64')}),/lost storage/);
    let [objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1);
    await workers.cleanup();[objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1,'delay protects an in-flight writer');
    const clean=await service.upload({sessionId:id,token,kind:'photo',name:'qa.png',base64:photo.toString('base64')});assert.equal(clean.status,'clean');
    time+=300001;await workers.cleanup();[objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1,'only the failed lease object is deleted');
    assert.equal((await service.sessionStatus({sessionId:id,token})).files[0].status,'clean');
    const current=(await db.collection(N.sessions).doc(id).get()).data().files[clean.id];assert.equal((await files.read(current)).mime,'image/jpeg');
    await assert.rejects(removePrivateObject(bucket,{path:'appointments/not-careers'}));
    time+=86400000;await workers.cleanup();[objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,0,'expired draft removes its own remaining object');
  }finally{await db.terminate();await deleteApp(app);}
});

test('lost Firestore finalization acknowledgement preserves clean bytes and submitted ownership',async()=>{
  const app=initializeApp({projectId:'demo-demac-careers',storageBucket:'demo-demac-careers.appspot.com'},'finalization-review');
  const db=getFirestore(app),bucket=getStorage(app).bucket(),time=Date.now(),C=require('./core');
  const files=createFiles({bucket,sharp,scanner:async()=>{}}),token='b'.repeat(64);
  const photo=await sharp({create:{width:64,height:64,channels:3,background:'#eee'}}).png().toBuffer();
  try {
    for (const adopted of [false,true]) {
      const id=crypto.randomUUID();
      await db.collection(N.sessions).doc(id).set({id,files:{},status:'draft',secretHash:C.digest(token),expiresAt:time+86400000});
      let armed=true,ackLost=false;
      const faultDb={collection:name=>db.collection(name),runTransaction:async work=>{
        let finalized=false;
        const result=await db.runTransaction(tx=>{
          finalized=false;
          const wrapped={get:tx.get.bind(tx),set:tx.set.bind(tx),create:tx.create.bind(tx),delete:tx.delete.bind(tx),update:(ref,values)=>{
            if(Object.values(values).some(value=>value?.status==='clean'))finalized=true;
            return tx.update(ref,values);
          }};
          return work(wrapped);
        });
        if(armed&&finalized){
          armed=false;ackLost=true;
          if(adopted){
            const session=(await db.collection(N.sessions).doc(id).get()).data();
            await db.collection(N.applications).doc(id).set({id,documents:Object.values(session.files),expiresAt:time+172800000});
            await db.collection(N.sessions).doc(id).delete();
          }
          throw Error('Simulated lost Firestore finalization acknowledgement');
        }
        return result;
      }};
      const service=createService({db:faultDb,files,infrastructure:{},now:()=>time});
      const payload={sessionId:id,token,kind:'photo',name:'qa.png',base64:photo.toString('base64')};
      if(adopted)await assert.rejects(service.upload(payload),/lost Firestore/);
      else {
        const result=await service.upload(payload);assert.equal(result.status,'clean');
        assert.equal((await service.upload(payload)).id,result.id,'retry returns the same clean document');
      }
      assert(ackLost,'fault occurs after a real emulator transaction committed');
      const queued=await db.collection(N.deletions).get();
      assert(!queued.docs.some(doc=>doc.data().path.startsWith(`careers-private/${id}/`)),'owned bytes never enter deletion queue');
      const [objects]=await bucket.getFiles({prefix:`careers-private/${id}/`});assert.equal(objects.length,1);
      const record=adopted?(await db.collection(N.applications).doc(id).get()).data().documents[0]:Object.values((await db.collection(N.sessions).doc(id).get()).data().files)[0];
      assert.equal((await files.read(record)).mime,'image/jpeg','owned file is still readable');
    }
  } finally {await db.terminate();await deleteApp(app);}
});
