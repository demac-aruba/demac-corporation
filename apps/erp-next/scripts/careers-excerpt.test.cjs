const test=require('node:test'),assert=require('node:assert/strict');
const {careersExcerpt}=require('../lib/careers-excerpt.ts');
test('role/card excerpts remain bounded without changing full editorial content',()=>{
 const source='We install and maintain cooling systems. '.repeat(30);
 const before=source,excerpt=careersExcerpt(source);
 assert(excerpt.length<=180);assert(excerpt.endsWith('…'));assert.equal(source,before);
 assert.equal(careersExcerpt('Short approved summary.'),'Short approved summary.');
 assert.equal(careersExcerpt('X'.repeat(240)).length,180);
});
