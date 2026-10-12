'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { customerProduct } = require('./demacCustomerSalesTools');
const { canonicalMoney, catalogPrice } = require('./servicePricingAuthority');
test('customer catalog and pricing authority distinguish unpriced from explicit zero', () => {
 for (const value of [null,undefined,'',' ',false,[],{}]) {
  assert.equal(customerProduct({basePrice:value}).basePrice,null);
  assert.equal(canonicalMoney(value),null);
  assert.throws(()=>catalogPrice({service:{id:'synthetic',basePrice:value}}));
 }
 for (const value of [0,'0',125,'125.50']) {
  assert.equal(customerProduct({basePrice:value}).basePrice,Number(value));
  assert.equal(catalogPrice({service:{id:'synthetic',basePrice:value}}).unitPrice,Number(value));
 }
});
