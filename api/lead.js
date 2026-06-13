// Vercel serverless function — receives lead from landing page form
// Required Vercel environment variables:
//   TWILIO_ACCOUNT_SID      — Twilio account SID
//   TWILIO_AUTH_TOKEN       — Twilio auth token
//   TWILIO_FROM_NUMBER      — Twilio sending number (default +18553034515)
//   GOOGLE_CLIENT_EMAIL     — Service account email from Google Cloud
//   GOOGLE_PRIVATE_KEY      — Service account private key (with \n as newlines)

const crypto = require('crypto');

const SHEET_ID = '1VLvGJVTNJus2qPZAOBbAclyHh_Fh0f57DFdnWuOmtrs';

const SERVICE_TABS = {
  fence: 'Fence',
  concrete: 'Concrete',
  epoxy: 'Epoxy Flooring',
  patios: 'Patios',
  pergolas: 'Pergolas',
};

async function getGoogleAccessToken() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claimsObj = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const payload = Buffer.from(JSON.stringify(claimsObj)).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(rawKey, 'base64url');

  const jwt = `${header}.${payload}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const { access_token } = await tokenRes.json();
  return access_token;
}

async function appendToSheet(tab, values) {
  const token = await getGoogleAccessToken();
  const range = encodeURIComponent(`${tab}!A:L`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [values] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API error: ${res.status} ${err}`);
  }
}

async function sendSMS(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER || '+18553034515';

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${authToken}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: `+1${to.replace(/\D/g, '')}`,
      From: from,
      Body: body,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio error to ${to}: ${res.status} ${err}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    firstName, lastName, phone, email, zip,
    service, subtype, size, quoteLow, quoteHigh,
  } = req.body || {};

  const tab = SERVICE_TABS[service] || 'Fence';
  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const sizeUnit = service === 'fence' ? 'lin ft' : 'sq ft';
  const smsBody =
    `NEW PRESTIGE LEAD\n\n` +
    `${firstName} ${lastName}\n` +
    `Phone: ${phone}\n` +
    `Email: ${email}\n` +
    `ZIP: ${zip}\n\n` +
    `Service: ${tab}\n` +
    `Type: ${subtype}\n` +
    `Size: ${size} ${sizeUnit}\n` +
    `Est. Quote: $${quoteLow} - $${quoteHigh}\n\n` +
    `Time: ${timestamp} CST`;

  const sheetRow = [
    timestamp, firstName, lastName, phone, email, zip,
    tab, subtype, `${size} ${sizeUnit}`, `$${quoteLow}`, `$${quoteHigh}`, 'Landing Page',
  ];

  const results = await Promise.allSettled([
    sendSMS('5806701829', smsBody),
    sendSMS('5803048470', smsBody),
    appendToSheet(tab, sheetRow),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Task ${i} failed:`, r.reason?.message);
    }
  });

  res.status(200).json({ ok: true });
};
