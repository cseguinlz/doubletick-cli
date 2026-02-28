#!/usr/bin/env node

import { program } from 'commander';
import { marked } from 'marked';
import { authenticate, isAuthenticated, getUserEmail } from '../lib/auth.js';
import { sendEmail, createDraft } from '../lib/gmail.js';
import { generateTrackingId, injectPixel, registerTrack, checkStatus, getDashboard } from '../lib/tracking.js';

program
  .name('doubletick')
  .description('Email read tracking via DoubleTick')
  .version('1.0.0');

// ── auth ──────────────────────────────────────────────────────────────
program
  .command('auth')
  .description('Authenticate with Gmail and DoubleTick (one-time setup)')
  .option('--client-id <id>', 'Custom Google OAuth client ID (optional)')
  .option('--client-secret <secret>', 'Custom Google OAuth client secret (optional)')
  .action(async (opts) => {
    try {
      await authenticate(opts.clientId, opts.clientSecret);
      console.log('\nSetup complete! You can now send tracked emails.');
    } catch (err) {
      console.error('Auth failed:', err.message);
      process.exit(1);
    }
  });

// ── send ──────────────────────────────────────────────────────────────
program
  .command('send')
  .description('Send a tracked email (creates draft by default)')
  .requiredOption('--to <email>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <body>', 'Email body (markdown or HTML)')
  .option('--cc <emails>', 'CC recipients (comma-separated)')
  .option('--bcc <emails>', 'BCC recipients (comma-separated)')
  .option('--html', 'Treat body as raw HTML (skip markdown conversion)')
  .option('--send', 'Send immediately instead of creating a draft')
  .option('--body-file <path>', 'Read body from file instead of --body')
  .action(async (opts) => {
    try {
      if (!isAuthenticated()) {
        console.error('Not authenticated. Run `doubletick auth` first.');
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
        // Wrap in minimal HTML if not already a full document
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

      // Send or create draft
      if (opts.send) {
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
        console.log(`  Message ID: ${result.messageId}`);
      } else {
        const result = await createDraft({
          to: opts.to,
          subject: opts.subject,
          htmlBody,
          cc: opts.cc,
          bcc: opts.bcc,
        });
        console.log(`\nDraft created in Gmail. Review and send when ready.`);
        console.log(`  To: ${opts.to}`);
        console.log(`  Subject: ${opts.subject}`);
        console.log(`  Tracking ID: ${trackingId}`);
        console.log(`  Draft ID: ${result.draftId}`);
      }

      console.log(`\nCheck status: doubletick status ${trackingId}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

// ── status ────────────────────────────────────────────────────────────
program
  .command('status <trackingId>')
  .description('Check if a tracked email has been opened')
  .action(async (trackingId) => {
    try {
      if (!isAuthenticated()) {
        console.error('Not authenticated. Run `doubletick auth` first.');
        process.exit(1);
      }

      const data = await checkStatus(trackingId);

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
        console.error('Not authenticated. Run `doubletick auth` first.');
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
