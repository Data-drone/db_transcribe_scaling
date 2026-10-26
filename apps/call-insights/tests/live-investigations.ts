/** Scoped acceptance record: pnpm exec tsx tests/live-investigations.ts <app-url> <interaction-id> */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sql } from '@databricks/appkit';
import { z } from 'zod';
import { investigationSchema } from '../shared/investigations';

const profile = 'fevm-serverless-stable-prvwqx';
const [appUrl, interactionId] = process.argv.slice(2);
if (!appUrl || !interactionId) throw new Error('Provide the deployed app URL and an authorized interaction ID.');
const origin = new URL(appUrl);
if (
  origin.protocol !== 'https:' ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error('The deployed app URL must be an HTTPS origin.');
if (process.env.DATABRICKS_CONFIG_PROFILE && process.env.DATABRICKS_CONFIG_PROFILE !== profile)
  throw new Error('Use the project-selected Databricks profile.');

// The token remains in this process; no credential or source transcript is logged.
const tokenJson: unknown = JSON.parse(
  execFileSync('databricks', ['auth', 'token', '--profile', profile, '--output', 'json'], { encoding: 'utf8' })
);
const token = z.object({ access_token: z.string().min(1) }).parse(tokenJson).access_token;
async function request(path: string, expected: number, body?: unknown) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(180000),
  });
  if (response.status !== expected) {
    await response.body?.cancel();
    throw new Error(`${path}: expected HTTP ${expected}, received ${response.status}.`);
  }
  return response;
}
async function analytics(key: 'call_detail' | 'call_segments') {
  const response = await request(`/api/analytics/query/${key}`, 200, {
    parameters: { interaction_id: sql.string(interactionId) },
    format: 'JSON_ARRAY',
  });
  const events = (await response.text()).split(/\r?\n\r?\n/);
  for (const event of events) {
    const payload = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!payload) continue;
    const message = z
      .object({ type: z.string().optional(), data: z.array(z.unknown()).optional(), error: z.string().optional() })
      .parse(JSON.parse(payload));
    if (message.error) throw new Error(`The authorized ${key} query failed.`);
    if (message.type === 'result' && message.data) return message.data;
  }
  throw new Error(`The authorized ${key} query returned no result.`);
}
const identity = z
  .object({ email: z.email(), user: z.string().min(1) })
  .parse(await (await request('/api/whoami', 200)).json());
const call = z
  .array(z.object({ interaction_id: z.string(), duration_seconds: z.coerce.number().positive() }))
  .parse(await analytics('call_detail'))[0];
if (!call || call.interaction_id !== interactionId)
  throw new Error('The requested source conversation is unavailable.');
const turns = z
  .array(
    z.object({
      start_seconds: z.coerce.number().nonnegative(),
      end_seconds: z.coerce.number().positive(),
      text: z.string().nullable(),
      is_masked: z
        .union([z.boolean(), z.literal('true'), z.literal('false')])
        .transform((v) => v === true || v === 'true'),
    })
  )
  .parse(await analytics('call_segments'));

// Find one stable whole-turn interval, using the independently fetched masked
// source as the expected text. Rejected candidates cause no document writes.
function chooseExcerpt() {
  for (const turn of turns) {
    let start = turn.start_seconds;
    let end = turn.end_seconds;
    for (let iteration = 0; iteration <= turns.length; iteration++) {
      const selected = turns.filter((item) => item.end_seconds > start && item.start_seconds < end);
      if (!selected.length) break;
      const nextStart = Math.min(...selected.map((item) => item.start_seconds));
      const nextEnd = Math.max(...selected.map((item) => item.end_seconds));
      if (
        nextEnd > call.duration_seconds ||
        nextEnd - nextStart > 600 ||
        selected.some((item) => !item.is_masked || !item.text?.trim())
      )
        break;
      if (nextStart === start && nextEnd === end)
        return { start, end, text: selected.map((item) => item.text).join(' ') };
      start = nextStart;
      end = nextEnd;
    }
  }
  throw new Error('This conversation has no valid fully masked excerpt; no acceptance record was created.');
}
const excerpt = chooseExcerpt();
const marker = `Deployment acceptance ${new Date().toISOString()} ${randomUUID().slice(0, 8)}`;
let record = investigationSchema.parse(
  await (
    await request('/api/investigations', 201, {
      title: marker,
      question: 'Automated deployment acceptance: verify masked evidence, durable notes and source export links.',
    })
  ).json()
);
const casePath = `/api/investigations/${record.id}`;
console.log(JSON.stringify({ createdAcceptanceCase: new URL(`/cases/${record.id}`, origin).href }));
if (!record.canEdit || record.ownerEmail !== identity.email.toLowerCase())
  throw new Error('New case owner is incorrect.');
record = investigationSchema.parse(
  await (
    await request(`${casePath}/items`, 201, {
      version: record.version,
      item: {
        type: 'clip',
        interactionId,
        start: excerpt.start,
        end: excerpt.end,
        note: 'Acceptance check: saved from the current authorized masked source.',
      },
    })
  ).json()
);
const clip = record.items.find((item) => item.type === 'clip');
if (
  !clip ||
  record.excerpts[clip.id]?.text !== excerpt.text ||
  clip.start !== excerpt.start ||
  clip.end !== excerpt.end
)
  throw new Error('Saved evidence does not match the authorized masked source.');
const note = 'Acceptance check: this note must survive a fresh case read.';
record = investigationSchema.parse(
  await (
    await request(`${casePath}/items`, 201, {
      version: record.version,
      item: { type: 'note', note },
    })
  ).json()
);
const reloaded = investigationSchema.parse(await (await request(casePath, 200)).json());
if (
  reloaded.title !== marker ||
  reloaded.version !== record.version ||
  !reloaded.items.some((item) => item.type === 'note' && item.note === note) ||
  reloaded.excerpts[clip.id]?.text !== excerpt.text
)
  throw new Error('Case evidence or notes did not survive reload.');
const exported = await request(`${casePath}/brief`, 200);
if (!exported.headers.get('content-type')?.startsWith('text/markdown')) throw new Error('The brief is not Markdown.');
const brief = await exported.text();
const sourceLink = /\[Open conversation\]\((https:\/\/[^\s)]+)\)/.exec(brief)?.[1];
if (!sourceLink) throw new Error('The brief has no HTTPS source link.');
const backlink = new URL(sourceLink);
if (
  backlink.origin !== origin.origin ||
  backlink.pathname !== `/calls/${encodeURIComponent(interactionId)}` ||
  backlink.searchParams.get('t') !== String(clip.start) ||
  backlink.searchParams.get('from') !== `/cases/${record.id}` ||
  !brief.includes(excerpt.text) ||
  !brief.includes(note) ||
  !brief.includes('not an estimate of prevalence or causality')
)
  throw new Error('The brief evidence, limitations or timestamp backlink is incorrect.');
console.log(
  JSON.stringify({
    passed: true,
    caseId: record.id,
    caseUrl: new URL(`/cases/${record.id}`, origin).href,
    interactionId,
    start: clip.start,
    end: clip.end,
    checks: [
      'real-masked-source',
      'case-create',
      'clip-save',
      'note-save',
      'case-reload',
      'markdown-export',
      'https-timestamp-backlink',
    ],
  })
);
