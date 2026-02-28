import crypto from 'crypto';
import { getApiKey, getUserEmail } from './auth.js';

const API_BASE = 'https://api.doubletickr.com';

export function generateTrackingId() {
  return crypto.randomUUID();
}

export function injectPixel(html, trackingId) {
  const rand = Math.random().toString(36).substring(2, 10);
  const pixel = `<img src="${API_BASE}/img?t=${trackingId}&r=${rand}" width="1" height="1" style="display:none;border:0;" alt="">`;

  if (html.includes('</body>')) {
    return html.replace('</body>', pixel + '</body>');
  }
  return html + pixel;
}

export async function registerTrack({ trackingId, recipientEmail, emailSubject }) {
  const apiKey = getApiKey();
  const senderEmail = getUserEmail();

  const res = await fetch(`${API_BASE}/track`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      trackingId,
      senderEmail,
      recipientEmail,
      emailSubject: emailSubject?.substring(0, 500),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      throw new Error('Weekly tracking limit reached. Upgrade to Pro for unlimited tracking.');
    }
    throw new Error(`Failed to register track (${res.status}): ${body}`);
  }

  return res.json();
}

export async function checkStatus(trackingId) {
  const apiKey = getApiKey();

  const res = await fetch(`${API_BASE}/status?id=${encodeURIComponent(trackingId)}`, {
    headers: { 'X-API-Key': apiKey },
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) {
      throw new Error(`Tracking ID not found: ${trackingId}`);
    }
    throw new Error(`Failed to check status (${res.status}): ${body}`);
  }

  return res.json();
}

export async function getDashboard(limit = 25) {
  const apiKey = getApiKey();
  const email = getUserEmail();

  const res = await fetch(
    `${API_BASE}/dashboard?email=${encodeURIComponent(email)}&limit=${limit}`,
    { headers: { 'X-API-Key': apiKey } }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch dashboard (${res.status}): ${body}`);
  }

  return res.json();
}
