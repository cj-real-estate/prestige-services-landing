// Vercel serverless function — receives lead from landing page form
// Required Vercel environment variables:
//   TWILIO_ACCOUNT_SID      — Twilio account SID
//   TWILIO_AUTH_TOKEN       — Twilio auth token
//   TWILIO_FROM_NUMBER      — Twilio sending number (default +18553034515)
//   GOOGLE_CLIENT_EMAIL     — Service account email from Google Cloud
//   GOOGLE_PRIVATE_KEY      — Service account private key (with \n as newlines)

const { getGoogleAccessToken } = require('../lib/google');

// Existing "Prestige_Services_Tracker" workbook (owned by calebjfree@gmail.com)
const SHEET_ID = '1xUt5eLvNKHQ6QmeAb88FNVTpPL1MEiWxAb5_szcfwss';

// Landing-page service key -> lead tab name in the workbook.
const SERVICE_TABS = {
  fence: 'Fence Leads',
  concrete: 'Concrete Leads',
  epoxy: 'Epoxy Leads',
  patios: 'Patios Leads',
  pergolas: 'Pergolas Leads',
};

const SERVICE_LABELS = {
  fence: 'Fence',
  concrete: 'Concrete',
  epoxy: 'Epoxy Flooring',
  patios: 'Patios',
  pergolas: 'Pergolas',
};

async function appendToSheet(tab, values) {
  const token = await getGoogleAccessToken();
  // Lead tabs span columns A:K (Date Added ... Notes)
  const range = encodeURIComponent(`${tab}!A:K`);
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
    service, subtype, size, quoteLow, quoteHigh, gclid,
  } = req.body || {};

  const tab = SERVICE_TABS[service] || 'Other Leads';
  const serviceLabel = SERVICE_LABELS[service] || service || 'Unknown';

  // Date Added formatted MM/DD/YYYY (Central) to match existing rows
  const dateAdded = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const sizeUnit = service === 'fence' ? 'lin ft' : 'sq ft';
  const estValue = quoteLow != null && quoteHigh != null
    ? Math.round((Number(quoteLow) + Number(quoteHigh)) / 2)
    : '';

  // Notes: preserve the funnel detail (real service, sub-type, size, full range)
  const notes =
    `Landing page funnel — ${serviceLabel} / ${subtype} · ${size} ${sizeUnit}` +
    (quoteLow != null ? ` · Est $${Number(quoteLow).toLocaleString()}-$${Number(quoteHigh).toLocaleString()}` : '') +
    (zip ? ` · ZIP ${zip}` : '');

  // Row matches lead-tab columns A:K:
  // Date Added | First Name | Last Name | Email | Phone | Service Type | Est. Value | Status | GCLID | Follow-Up Date | Notes
  const sheetRow = [
    dateAdded,
    firstName || '',
    lastName || '',
    email || '',
    phone || '',
    subtype || serviceLabel,
    estValue ? `$${estValue.toLocaleString()}` : '',
    'Open',
    gclid || '',
    '',
    notes,
  ];

  const smsBody =
    `NEW PRESTIGE LEAD\n\n` +
    `${firstName} ${lastName}\n` +
    `Phone: ${phone}\n` +
    `Email: ${email}\n` +
    `ZIP: ${zip}\n\n` +
    `Service: ${serviceLabel}\n` +
    `Type: ${subtype}\n` +
    `Size: ${size} ${sizeUnit}\n` +
    `Est. Quote: $${quoteLow} - $${quoteHigh}\n\n` +
    `Logged to: ${tab}\n` +
    `${dateAdded} CST`;

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
