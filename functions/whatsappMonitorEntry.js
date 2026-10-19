'use strict';
// Standalone deployment. Never export operational Booking/WhatsApp functions here.
const {initializeApp,getApps}=require('firebase-admin/app');
if(!getApps().length)initializeApp();
module.exports=require('./whatsappMonitor');
