const cryptoUtils = require("./CryptoUtils.js");
const shared = require("./shared.json");
const dotenv = require("dotenv");
dotenv.config();

function generateAuthPayload() {
  const salt = process.env.Salt;
  if (!salt) {
    throw new Error("LeagueSalt não definida no .env");
  }

  return shared;
}

module.exports = {
  generateAuthPayload
};