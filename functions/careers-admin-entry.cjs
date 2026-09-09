'use strict';
// Deployment entrypoint only. Reuse the audited authority; export no public or scheduled function.
exports.careersAdmin = require('./careers').careersAdmin;
