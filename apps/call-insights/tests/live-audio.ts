/** Read-only deployed transport check: pnpm exec tsx tests/live-audio.ts <app-url> <interaction-id> */
import { execFileSync } from 'node:child_process';
import { z } from 'zod';

const profile = 'fevm-serverless-stable-prvwqx';
const [appUrl, interactionId] = process.argv.slice(2);
if (!appUrl || !interactionId) throw new Error('Provide the deployed app URL and an authorized interaction ID.');
const origin = new URL(appUrl);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search)
  throw new Error('The deployed app URL must be an HTTPS origin.');
if (process.env.DATABRICKS_CONFIG_PROFILE && process.env.DATABRICKS_CONFIG_PROFILE !== profile)
  throw new Error('Use the project-selected Databricks profile.');

// Read the selected profile's token directly into memory; never log or write it.
const raw: unknown = JSON.parse(
  execFileSync('databricks', ['auth', 'token', '--profile', profile, '--output', 'json'], { encoding: 'utf8' })
);
const token = z.object({ access_token: z.string().min(1) }).parse(raw).access_token;
function request(path: string, range?: string) {
  return fetch(new URL(path, origin), {
    headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
}
async function status(response: Response, expected: number, label: string) {
  if (response.status !== expected) {
    await response.body?.cancel();
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}.`);
  }
}

const identity = await request('/api/whoami');
await status(identity, 200, 'Signed-in identity');
z.object({ email: z.email(), user: z.string().min(1) }).parse(await identity.json());

const audioPath = `/api/calls/${encodeURIComponent(interactionId)}/audio`;
const first = await request(audioPath, 'bytes=0-43');
await status(first, 206, 'WAV header range');
if (!first.headers.get('content-type')?.startsWith('audio/wav')) throw new Error('Audio content type is invalid.');
if (first.headers.get('cache-control') !== 'private, no-store') throw new Error('Audio must not use a shared cache.');
const range = /^bytes 0-43\/(\d+)$/.exec(first.headers.get('content-range') ?? '');
const size = Number(range?.[1]);
if (!range || !Number.isSafeInteger(size) || size < 44) throw new Error('Audio Content-Range is invalid.');
const header = Buffer.from(await first.arrayBuffer());
if (header.length !== 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE')
  throw new Error('The source did not return a complete WAV header.');

const suffix = await request(audioPath, 'bytes=-16');
await status(suffix, 206, 'Suffix range');
if (suffix.headers.get('content-range') !== `bytes ${size - 16}-${size - 1}/${size}`)
  throw new Error('Suffix Content-Range is invalid.');
if ((await suffix.arrayBuffer()).byteLength !== 16) throw new Error('Suffix byte count is invalid.');

const invalid = await request(audioPath, `bytes=${size}-`);
await status(invalid, 416, 'Unsatisfiable range');
if (invalid.headers.get('content-range') !== `bytes */${size}`)
  throw new Error('Unsatisfiable range did not report the source size.');
await invalid.body?.cancel();

for (const alias of ['audio', 'files']) {
  const generic = await request(`/api/files/${alias}/list`);
  await status(generic, 403, `Generic Files access (${alias})`);
  await generic.body?.cancel();
}

console.log(
  JSON.stringify({
    passed: true,
    interactionId,
    audioBytes: size,
    checks: ['identity', 'wav-206', 'suffix-206', 'range-416', 'generic-files-denied'],
  })
);
