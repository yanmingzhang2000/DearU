const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dearu-dev-secret-change-in-production';
const JWT_EXPIRES = '30d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
