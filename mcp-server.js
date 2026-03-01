#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { marked } from 'marked';
import { isAuthenticated } from './lib/auth.js';
import { sendEmail } from './lib/gmail.js';
import { generateTrackingId, injectPixel, registerTrack, checkStatus, getDashboard } from './lib/tracking.js';

const server = new McpServer({
  name: 'doubletick',
  version: '1.0.0',
});

// ── send_tracked_email ────────────────────────────────────────────────
server.tool(
  'send_tracked_email',
  'Send an email with read tracking via Gmail. Body accepts markdown (converted to HTML automatically). The email is sent immediately via Gmail API.',
  {
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body in markdown or HTML'),
    cc: z.string().optional().describe('CC recipients (comma-separated)'),
    bcc: z.string().optional().describe('BCC recipients (comma-separated)'),
    html: z.boolean().default(false).describe('Treat body as raw HTML (skip markdown conversion)'),
  },
  async ({ to, subject, body, cc, bcc, html }) => {
    if (!isAuthenticated()) {
      return { content: [{ type: 'text', text: 'Not authenticated. Run `doubletick login` in the terminal first.' }] };
    }

    // Convert body
    let htmlBody;
    if (html) {
      htmlBody = body;
    } else {
      htmlBody = await marked(body);
      if (!htmlBody.includes('<html')) {
        htmlBody = `<!DOCTYPE html><html><body>${htmlBody}</body></html>`;
      }
    }

    // Inject pixel
    const trackingId = generateTrackingId();
    htmlBody = injectPixel(htmlBody, trackingId);

    // Register track
    await registerTrack({ trackingId, recipientEmail: to, emailSubject: subject });

    // Send via Gmail API
    const result = await sendEmail({ to, subject, htmlBody, cc, bcc });
    return {
      content: [{
        type: 'text',
        text: `Email sent and tracking.\n\nTo: ${to}\nSubject: ${subject}\nTracking ID: ${trackingId}\n\nCheck status with check_tracking_status tool.`,
      }],
    };
  }
);

// ── check_tracking_status ─────────────────────────────────────────────
server.tool(
  'check_tracking_status',
  'Check if a tracked email has been opened. Returns open count, device info, and timestamps.',
  {
    trackingId: z.string().describe('Tracking ID returned from send_tracked_email'),
  },
  async ({ trackingId }) => {
    if (!isAuthenticated()) {
      return { content: [{ type: 'text', text: 'Not authenticated. Run `doubletick login` in the terminal first.' }] };
    }

    const data = await checkStatus(trackingId);

    let text = `Tracking: ${data.trackingId}\n`;
    text += `Subject: ${data.emailSubject || '(no subject)'}\n`;
    text += `To: ${data.recipientEmail || '(unknown)'}\n`;
    text += `Status: ${data.statusMessage}\n`;
    text += `Open count: ${data.openCount}\n`;

    if (data.opens?.length > 0) {
      text += '\nOpens:\n';
      for (const open of data.opens) {
        text += `  - ${open.formattedTimestamp || open.timeAgo} · ${open.device || 'Unknown'}\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ── list_tracked_emails ───────────────────────────────────────────────
server.tool(
  'list_tracked_emails',
  'List recent tracked emails with their open status.',
  {
    limit: z.number().default(10).describe('Number of results to return (max 200)'),
  },
  async ({ limit }) => {
    if (!isAuthenticated()) {
      return { content: [{ type: 'text', text: 'Not authenticated. Run `doubletick login` in the terminal first.' }] };
    }

    const data = await getDashboard(limit);
    const s = data.stats;

    let text = `Plan: ${s.plan} · Tracked: ${s.totalTracked} · Open rate: ${s.openRate}%\n`;
    if (s.weeklyLimit) {
      text += `Weekly usage: ${s.weeklyUsage}/${s.weeklyLimit}\n`;
    }

    if (data.tracks.length === 0) {
      text += '\nNo tracked emails yet.';
    } else {
      text += '\nRecent tracked emails:\n';
      for (const t of data.tracks) {
        const opened = t.openCount > 0 ? `Opened ${t.openCount}x` : 'Not opened';
        const device = t.lastDevice ? ` · ${t.lastDevice}` : '';
        text += `\n- ${t.emailSubject || '(no subject)'}\n`;
        text += `  To: ${t.recipientEmail || '?'} · ${opened}${device}\n`;
        text += `  ID: ${t.trackingId} · Sent: ${t.createdTimeAgo}\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ── Start server ──────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
