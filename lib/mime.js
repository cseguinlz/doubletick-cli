export function buildMimeMessage({ from, to, subject, htmlBody, cc, bcc }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
  ];

  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);

  lines.push(
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlBody).toString('base64'),
  );

  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64url');
}
