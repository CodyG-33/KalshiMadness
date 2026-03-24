/**
 * Node 20+ / OpenSSL 3: RSA-PSS sign may throw ERR_OSSL_UNSUPPORTED with a raw PEM
 * string. Wrapping with createPrivateKey() fixes Kalshi auth (kalshi-typescript).
 * Idempotent — runs on every npm install.
 */
const fs = require("fs");
const path = require("path");

const MARKER = "/* kalshi-madness: createPrivateKey PSS patch */";

const FROM = `        const signature = sign.sign({
            key: this.privateKeyPem,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        });`;

const TO = `        ${MARKER}
        const _kalshiKey = crypto.createPrivateKey(this.privateKeyPem);
        const signature = sign.sign({
            key: _kalshiKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        });`;

const files = [
  path.join(__dirname, "..", "node_modules", "kalshi-typescript", "dist", "auth.js"),
  path.join(__dirname, "..", "node_modules", "kalshi-typescript", "dist", "esm", "auth.js"),
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let s = fs.readFileSync(file, "utf8");
  if (s.includes(MARKER)) continue;
  if (!s.includes(FROM)) {
    console.warn(`[patch-kalshi-pss] skip (unexpected content): ${file}`);
    continue;
  }
  fs.writeFileSync(file, s.replace(FROM, TO));
  console.log(`[patch-kalshi-pss] patched ${path.relative(process.cwd(), file)}`);
}
