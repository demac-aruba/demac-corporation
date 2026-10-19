'use strict';
const fs=require('node:fs');const path=require('node:path');
function packageMonitor(destination){
  const repo=path.resolve(__dirname,'..');const target=path.resolve(destination);
  if(target===repo||target.startsWith(repo+path.sep))throw Error('Stage outside repository.');
  if(fs.existsSync(target)&&(fs.lstatSync(target).isSymbolicLink()||fs.readdirSync(target).length))throw Error('Stage must be empty.');
  const files=new Map();
  function visit(name){
    if(files.has(name))return;
    if(!/^[A-Za-z0-9]+\.js$/.test(name) && !['data/papiamento-aruba-vocabulary-2009.json','data/message-copy-catalog.json'].includes(name))throw Error('Unexpected local dependency.');
    const content=fs.readFileSync(path.join(__dirname,name),'utf8');files.set(name,content);
    for(const match of content.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g))visit(/\.(js|json)$/.test(match[1])?match[1]:`${match[1]}.js`);
  }
  visit('whatsappMonitorEntry.js');
  if(files.has('bootstrap.js'))throw Error('Operational entry is forbidden.');
  fs.mkdirSync(target,{recursive:true});
  for(const [name,content] of files){const output=path.join(target,name==='whatsappMonitorEntry.js'?'index.js':name);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,content);}
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
  fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'demac-whatsapp-monitor',version:'1.0.0',private:true,main:'index.js',engines:{node:'22'},dependencies:Object.fromEntries(['firebase-admin','firebase-functions'].map(name=>[name,manifest.dependencies[name]]))},null,2)+'\n');
  return target;
}
if(require.main===module){if(!process.argv[2])throw Error('Supply an isolated staging directory.');console.log(packageMonitor(process.argv[2]));}
module.exports={packageMonitor};
