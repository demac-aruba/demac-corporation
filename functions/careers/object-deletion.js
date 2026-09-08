'use strict';
const C=require('./core');
/** Every pending object path is unique to an upload lease. Resolve a lost
 * acknowledgement's generation before deleting; never delete a new generation. */
async function removePrivateObject(bucket,record){
  if(!record.path)return;
  C.requireValue(/^careers-private\/[A-Za-z0-9_-]+\/[a-f0-9]{64}-[a-f0-9-]{36}$/.test(record.path),'Invalid document reference.');
  const file=bucket.file(record.path,record.generation?{generation:record.generation}:undefined);
  try{const generation=record.generation || (await file.getMetadata())[0].generation;await file.delete({ignoreNotFound:true,ifGenerationMatch:generation});}
  catch(error){if(error.code!==404)throw error;}
}
module.exports={removePrivateObject};
