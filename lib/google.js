// Shared Google service-account auth — mints an access token for the Sheets API.
// Requires env vars GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY.
const crypto = require('crypto');

async function getGoogleAccessToken(scope) {
  scope = scope || 'https://www.googleapis.com/auth/spreadsheets';
  let email = process.env.GOOGLE_CLIENT_EMAIL;
  let rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').trim();

  // Accept the whole service-account JSON pasted into GOOGLE_PRIVATE_KEY:
  // if it looks like JSON, parse it and pull out private_key / client_email.
  if (rawKey.startsWith('{')) {
    try {
      const json = JSON.parse(rawKey);
      if (json.private_key) rawKey = json.private_key;
      if (!email && json.client_email) email = json.client_email;
    } catch (e) {
      throw new Error('GOOGLE_PRIVATE_KEY looks like JSON but failed to parse');
    }
  }

  // Normalize the key across common paste variants:
  //  - strip surrounding double/single quotes copied from the JSON
  //  - convert literal \n escapes into real newlines
  //  - tolerate \r\n
  rawKey = rawKey.replace(/^["']|["']$/g, '');
  rawKey = rawKey.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(rawKey, 'base64url');

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Token error: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

module.exports = { getGoogleAccessToken };
