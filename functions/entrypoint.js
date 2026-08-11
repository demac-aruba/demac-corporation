const existingFunctions = require('./index');
const userManagementFunctions = require('./userManagement');

module.exports = {
  ...existingFunctions,
  ...userManagementFunctions,
};
