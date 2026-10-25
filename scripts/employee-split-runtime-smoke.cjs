'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const http = require('node:http');
const source = path.resolve(process.argv[2]);
const target = process.argv[3];
assert.ok(['workOrderApplication'].includes(target));
// Cloud Functions supplies these non-secret SDK options. The isolated test uses
// a synthetic bucket; the preload rejects all non-loopback network requests.
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-demac-dwelling-runtime',storageBucket:'demo-demac-dwelling-runtime.invalid'});
const load = createRequire(path.join(source, 'package.json'));
async function main() {
  const mod = load('./bootstrap.js');
  assert.equal(typeof mod[target], 'function', 'Runtime export missing: ' + target);
  const declared = load('./package.json').dependencies;
  if (declared.sharp) {
    const sharp = load('sharp');
    for (const channels of [3, 4]) {
      const png = await sharp({ create: { width: 8, height: 8, channels, background: '#336699' } }).png().toBuffer();
      const jpeg = await sharp(png, { limitInputPixels: 32000000, animated: false }).rotate().resize({ width: 4, height: 4, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      assert.equal((await sharp(jpeg).metadata()).width, 4);
    }
  }
  if (declared.nodemailer) {
    const mail = load('nodemailer').createTransport({ jsonTransport: true });
    const rendered = await mail.sendMail({ from: 'sender@example.invalid', to: 'synthetic@example.invalid', subject: 'Synthetic audit', text: 'No delivery' });
    assert.equal(JSON.parse(rendered.message).subject, 'Synthetic audit'); mail.close();
  }
  if (['workOrderApplication'].includes(target)) {
    const app = load('express')(); app.use(load('express').json()); app.all('/authority', mod[target]);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = 'http://127.0.0.1:' + server.address().port + '/authority';
      const headers = { Origin: 'https://demac-aruba.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' };
      const options=await fetch(url, { method: 'OPTIONS', headers });
      assert.equal(options.status,204,'Synthetic OPTIONS status=' + options.status);
      const action='complete_after_hours_work_order';
      const denied=await fetch(url, { method: 'POST', headers: { Origin: headers.Origin, 'Content-Type': 'application/json' }, body: JSON.stringify({action,data:{}}) });
      assert.equal(denied.status,401,'Synthetic anonymous POST status=' + denied.status);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  const admin = load('firebase-admin/app'); await Promise.all(admin.getApps().map(admin.deleteApp));
  console.log('PASS: real bootstrap; exact deployed entrypoint; native codec; local transports; anonymous HTTP boundary when applicable');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
