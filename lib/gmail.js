import { google } from 'googleapis';
import { getAuthenticatedClient, getUserEmail } from './auth.js';
import { buildMimeMessage } from './mime.js';

async function getGmailService() {
  const { client } = await getAuthenticatedClient();
  return google.gmail({ version: 'v1', auth: client });
}

export async function sendEmail({ to, subject, htmlBody, cc, bcc }) {
  const gmail = await getGmailService();
  const from = getUserEmail();

  const raw = buildMimeMessage({ from, to, subject, htmlBody, cc, bcc });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return { messageId: res.data.id, threadId: res.data.threadId };
}

export async function createDraft({ to, subject, htmlBody, cc, bcc }) {
  const gmail = await getGmailService();
  const from = getUserEmail();

  const raw = buildMimeMessage({ from, to, subject, htmlBody, cc, bcc });

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw },
    },
  });

  return { draftId: res.data.id, messageId: res.data.message.id };
}
