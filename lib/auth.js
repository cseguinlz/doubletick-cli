import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import { exec } from 'child_process';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.doubletick');
const TOKEN_PATH = path.join(CONFIG_DIR, 'credentials.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/userinfo.email',
];

const API_BASE = 'https://api.doubletickr.com';

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  }
  return null;
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getOAuth2Client(config) {
  if (!config?.clientId || !config?.clientSecret) {
    throw new Error('Not authenticated. Run `doubletick auth` first.');
  }
  const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri || 'http://localhost:3456');
  if (config.tokens) {
    client.setCredentials(config.tokens);
  }
  return client;
}

export async function getAuthenticatedClient() {
  const config = loadConfig();
  if (!config?.tokens?.refresh_token) {
    throw new Error('Not authenticated. Run `doubletick auth` first.');
  }
  const client = getOAuth2Client(config);

  // Refresh if expired
  if (config.tokens.expiry_date && config.tokens.expiry_date < Date.now()) {
    const { credentials } = await client.refreshAccessToken();
    config.tokens = credentials;
    saveConfig(config);
    client.setCredentials(credentials);
  }

  return { client, config };
}

export function getApiKey() {
  const config = loadConfig();
  if (!config?.apiKey) {
    throw new Error('Not authenticated. Run `doubletick auth` first.');
  }
  return config.apiKey;
}

export function getUserEmail() {
  const config = loadConfig();
  if (!config?.email) {
    throw new Error('Not authenticated. Run `doubletick auth` first.');
  }
  return config.email;
}

export async function authenticate(clientId, clientSecret) {
  ensureConfigDir();
  const redirectUri = 'http://localhost:3456';
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  // Auto-open browser (fallback: print URL)
  const openCmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${openCmd} "${authUrl}"`);
  console.log('\nOpening browser to authorize DoubleTick...');
  console.log('If the browser didn\'t open, visit this URL:\n');
  console.log(authUrl);
  console.log('');

  // Start local server to receive callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:3456`);
      const authCode = url.searchParams.get('code');
      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>DoubleTick authorized!</h2><p>You can close this tab.</p></body></html>');
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code');
      }
    });
    server.listen(3456);
    server.on('error', reject);
  });

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user email
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = await res.json();
  const email = userInfo.email;

  console.log(`\nAuthenticated as: ${email}`);

  // Auto-provision with DoubleTick API
  const deviceId = crypto.randomUUID();
  let apiKey;
  try {
    const provisionRes = await fetch(`${API_BASE}/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, deviceId }),
    });
    const provisionData = await provisionRes.json();
    apiKey = provisionData.apiKey;
    console.log(`DoubleTick API key provisioned.`);
  } catch (err) {
    console.error('Warning: Could not auto-provision DoubleTick API key.');
    console.error('You can set it manually in ~/.doubletick/credentials.json');
  }

  const config = {
    clientId,
    clientSecret,
    redirectUri,
    tokens,
    email,
    deviceId,
    apiKey: apiKey || null,
  };
  saveConfig(config);

  console.log(`\nCredentials saved to ${TOKEN_PATH}`);
  return config;
}

export function isAuthenticated() {
  const config = loadConfig();
  return !!(config?.tokens?.refresh_token && config?.apiKey);
}
