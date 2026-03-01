#!/usr/bin/env node

import { program } from 'commander';
import { marked } from 'marked';
import { authenticate, logout, isAuthenticated, getUserEmail } from '../lib/auth.js';
import { sendEmail } from '../lib/gmail.js';
import { generateTrackingId, injectPixel, registerTrack, checkStatus, getDashboard } from '../lib/tracking.js';

program
  .name('doubletick')
  .description('Email read tracking via DoubleTick')
  .version('1.0.0');

// ── login ─────────────────────────────────────────────────────────────
program
  .command('login')
  .description('Log in with your Gmail account (one-time setup)')
  .option('--client-id <id>', 'Custom Google OAuth client ID (optional)')
  .option('--client-secret <secret>', 'Custom Google OAuth client secret (optional)')
  .action(async (opts) => {
    try {
      await authenticate(opts.clientId, opts.clientSecret);
      console.log('\nSetup complete! You can now send tracked emails.');
      process.exit(0);
    } catch (err) {
      console.error('Login failed:', err.message);
      process.exit(1);
    }
  });

// ── logout ────────────────────────────────────────────────────────────
program
  .command('logout')
  .description('Log out and remove stored credentials')
  .action(() => {
    try {
      logout();
      console.log('Logged out. Credentials removed.');
    } catch (err) {
      console.error('Logout failed:', err.message);
      process.exit(1);
    }
  });

// ── send ──────────────────────────────────────────────────────────────
program
  .command('send')
  .description('Send a tracked email via Gmail')
  .requiredOption('--to <email>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <body>', 'Email body (markdown or HTML)')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--bcc <emails>', 'BCC recipients (comma-separated)')
  .option('--html', 'Treat body as raw HTML (skip markdown conversion)')
  .option('--body-file <path>', 'Read body from file instead of --body')
  .action(async (opts) => {
    try {
      if (!isAuthenticated()) {
        console.error('Not logged in. Run `doubletick login` first.');
        process.exit(1);
      }

      // Resolve body
      let body = opts.body;
      if (opts.bodyFile) {
        const fs = await import('fs');
        body = fs.readFileSync(opts.bodyFile, 'utf-8');
      }

      // Convert markdown → HTML unless --html flag
      let htmlBody;
      if (opts.html) {
        htmlBody = body;
      } else {
        htmlBody = await marked(body);
        if (!htmlBody.includes('<html')) {
          htmlBody = `<!DOCTYPE html><html><body>${htmlBody}</body></html>`;
        }
      }

      // Generate tracking ID and inject pixel
      const trackingId = generateTrackingId();
      htmlBody = injectPixel(htmlBody, trackingId);

      // Register track with DoubleTick API
      await registerTrack({
        trackingId,
        recipientEmail: opts.to,
        emailSubject: opts.subject,
      });

      // Send via Gmail API
      const result = await sendEmail({
        to: opts.to,
        subject: opts.subject,
        htmlBody,
        cc: opts.cc,
        bcc: opts.bcc,
      });

      console.log(`\nSent and tracking.`);
      console.log(`  To: ${opts.to}`);
      console.log(`  Subject: ${opts.subject}`);
      console.log(`  Tracking ID: ${trackingId}`);

      console.log(`\nCheck status: doubletick status --last`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ── status ────────────────────────────────────────────────────────────

function printStatus(data) {
  console.log(`\nTracking: ${data.trackingId}`);
  console.log(`Subject: ${data.emailSubject || '(no subject)'}`);
  console.log(`To: ${data.recipientEmail || '(unknown)'}`);
  console.log(`Status: ${data.statusMessage}`);

  if (data.openCount > 0) {
    console.log(`\nOpens (${data.openCount}):`);
    for (const open of data.opens || []) {
      const device = open.device || 'Unknown';
      const time = open.formattedTimestamp || open.timeAgo || '';
      console.log(`  - ${time} · ${device}`);
    }
  } else {
    console.log('\nNot opened yet.');
  }
}

program
  .command('status [trackingId]')
  .description('Check if a tracked email has been opened')
  .option('--last', 'Check the most recently sent tracked email')
  .option('--to <email>', 'Find tracked email by recipient')
  .action(async (trackingId, opts) => {
    try {
      if (!isAuthenticated()) {
        console.error('Not logged in. Run `doubletick login` first.');
        process.exit(1);
      }

      // Resolve tracking ID from shortcuts
      if (!trackingId && (opts.last || opts.to)) {
        const dashboard = await getDashboard(opts.to ? 200 : 1);
        const tracks = dashboard.tracks;

        if (opts.to) {
          const match = tracks.find(t =>
            t.recipientEmail?.toLowerCase() === opts.to.toLowerCase()
          );
          if (!match) {
            console.error(`No tracked email found for: ${opts.to}`);
            process.exit(1);
          }
          trackingId = match.trackingId;
        } else {
          if (tracks.length === 0) {
            console.error('No tracked emails yet.');
            process.exit(1);
          }
          trackingId = tracks[0].trackingId;
        }
      }

      if (!trackingId) {
        console.error('Provide a tracking ID, or use --last or --to <email>');
        process.exit(1);
      }

      const data = await checkStatus(trackingId);
      printStatus(data);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ── dashboard ─────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('List your tracked emails')
  .option('--limit <n>', 'Number of results', '25')
  .action(async (opts) => {
    try {
      if (!isAuthenticated()) {
        console.error('Not logged in. Run `doubletick login` first.');
        process.exit(1);
      }

      const data = await getDashboard(parseInt(opts.limit));

      // Stats
      const s = data.stats;
      console.log(`\nDoubleTick Dashboard (${getUserEmail()})`);
      console.log(`Plan: ${s.plan} · Tracked: ${s.totalTracked} · Open rate: ${s.openRate}%`);
      if (s.weeklyLimit) {
        console.log(`Weekly usage: ${s.weeklyUsage}/${s.weeklyLimit}`);
      }

      // Tracks table
      if (data.tracks.length === 0) {
        console.log('\nNo tracked emails yet.');
        return;
      }

      console.log('');
      for (const t of data.tracks) {
        const opened = t.openCount > 0 ? `Opened ${t.openCount}x` : 'Not opened';
        const device = t.lastDevice ? ` · ${t.lastDevice}` : '';
        const lastOpen = t.lastTimeAgo ? ` · ${t.lastTimeAgo}` : '';
        console.log(`  ${t.emailSubject || '(no subject)'}`);
        console.log(`    To: ${t.recipientEmail || '?'} · ${opened}${device}${lastOpen}`);
        console.log(`    ID: ${t.trackingId} · Sent: ${t.createdTimeAgo}`);
        console.log('');
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();
