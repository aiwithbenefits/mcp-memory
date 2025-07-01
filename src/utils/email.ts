export interface EmailData {
  subject: string;
  body: string;
  sender: string;
  recipients?: string[];
  date?: string;
  company?: string;
  messageId?: string;
  inReplyTo?: string;
}

export interface EmailRecord extends EmailData {
  id: string;
  userId: string;
  memoryId: string;
  created_at: string;
}

function extractCompanyFromEmail(email: string): string | undefined {
  const match = email.match(/@([^>]+)>?$/);
  if (!match) return undefined;
  const domain = match[1].toLowerCase();
  const parts = domain.split('.');
  if (parts.length > 2) parts.shift();
  return parts[0];
}

import { storeMemory, searchMemories } from './vectorize';
import { storeMemoryInD1 } from './db';
import { v4 as uuidv4 } from 'uuid';

export async function storeEmailMemory(
  email: EmailData,
  userId: string,
  env: Env
): Promise<string> {
  const memoryId = uuidv4();
  const company = email.company || extractCompanyFromEmail(email.sender);
  const recipients = email.recipients?.join(',') ?? '';
  const text = `${email.subject}\n${email.body}\nFrom: ${email.sender}\nTo: ${recipients}`;
  await storeMemoryInD1(text, userId, env, memoryId);
  await storeMemory(
    text,
    userId,
    env,
    {
      subject: email.subject,
      sender: email.sender,
      recipients,
      date: email.date ?? '',
      company: company ?? '',
      messageId: email.messageId ?? '',
      inReplyTo: email.inReplyTo ?? '',
    },
    memoryId,
  );
  const stmt = env.DB.prepare(
    'INSERT INTO emails (id, userId, memoryId, sender, recipients, subject, date, company, messageId, inReplyTo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  await stmt
    .bind(
      memoryId,
      userId,
      memoryId,
      email.sender,
      recipients,
      email.subject,
      email.date ?? '',
      company ?? '',
      email.messageId ?? '',
      email.inReplyTo ?? '',
    )
    .run();
  return memoryId;
}

export async function getEmailMetadata(
  memoryId: string,
  userId: string,
  env: Env
): Promise<EmailRecord | null> {
  const res = await env.DB.prepare(
    'SELECT * FROM emails WHERE memoryId = ? AND userId = ?'
  )
    .bind(memoryId, userId)
    .first();
  return res as EmailRecord | null;
}

export async function getEmailsMetadata(
  memoryIds: string[],
  userId: string,
  env: Env,
): Promise<Record<string, EmailRecord>> {
  if (memoryIds.length === 0) return {};
  const placeholders = memoryIds.map(() => '?').join(',');
  const query = `SELECT * FROM emails WHERE memoryId IN (${placeholders}) AND userId = ?`;
  const result = await env.DB.prepare(query)
    .bind(...memoryIds, userId)
    .all();
  const records: Record<string, EmailRecord> = {};
  for (const row of (result.results as unknown as EmailRecord[])) {
    records[row.memoryId] = row;
  }
  return records;
}

export async function getEmailWithContent(
  memoryId: string,
  userId: string,
  env: Env,
): Promise<(EmailRecord & { content: string }) | null> {
  const res = await env.DB.prepare(
    'SELECT e.*, m.content FROM emails e JOIN memories m ON e.memoryId = m.id WHERE e.memoryId = ? AND e.userId = ?',
  )
    .bind(memoryId, userId)
    .first();
  return res as (EmailRecord & { content: string }) | null;
}

export async function listEmails(userId: string, env: Env): Promise<EmailRecord[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM emails WHERE userId = ? ORDER BY date DESC, created_at DESC'
  )
    .bind(userId)
    .all();
  return result.results as unknown as EmailRecord[];
}

export async function deleteEmail(memoryId: string, userId: string, env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM emails WHERE memoryId = ? AND userId = ?')
    .bind(memoryId, userId)
    .run();
}

export async function searchEmailMemories(
  query: string,
  userId: string,
  env: Env,
  company?: string,
): Promise<Array<EmailRecord & { score: number }>> {
  const vectorResults = await searchMemories(query, userId, env);
  const ids = vectorResults.map((v) => v.id);
  const metadataMap = await getEmailsMetadata(ids, userId, env);
  return vectorResults
    .map((match) => {
      const meta = metadataMap[match.id];
      if (!meta) return undefined;
      if (company && meta.company !== company) return undefined;
      return { ...meta, score: match.score };
    })
    .filter(Boolean) as Array<EmailRecord & { score: number }>;
}
