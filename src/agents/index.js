const questionVerifier = require('./questionVerifier');
const monthlyOrderVerifier = require('./monthlyOrderVerifier');

module.exports = {
  ...questionVerifier,
  ...monthlyOrderVerifier,
  questionVerifier,
  monthlyOrderVerifier
};
