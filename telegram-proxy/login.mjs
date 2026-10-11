// One-time Telegram login for the feed. Run it on your own computer (Node 22 or newer), never on a shared machine:
//   cd telegram-proxy && npm ci && node login.mjs
// It asks for your api_id and api_hash (my.telegram.org → API development tools), your phone number, the code Telegram
// sends you and your two-step password if you have one, lists your groups so you can pick the ones with calls, makes a
// random key for the Worker to use, and prints what goes in Vercel and in Cloudflare. It saves nothing.
// The session it prints is full access to your Telegram account: paste it only into Vercel's environment variable.
// End it any time in Telegram → Settings → Devices.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { makeClient } from './api/telegram.mjs';

if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Needs Node 22 or newer.'); process.exit(1); }
const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = async (q) => (await rl.question(q)).trim();
const clean = (s) => String(s || '').replace(/[,:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

const apiId = await ask('api_id (my.telegram.org → API development tools): ');
const apiHash = await ask('api_hash: ');
if (!/^\d+$/.test(apiId) || !/^[0-9a-f]{32}$/i.test(apiHash)) { console.error('That api_id or api_hash does not look right.'); process.exit(1); }
const client = makeClient('', apiId, apiHash);
try {
  await client.start({
    phoneNumber: () => ask('Phone number with country code (e.g. +44…): '),
    phoneCode: () => ask('The code Telegram just sent you: '),
    password: (hint) => ask(`Two-step verification password${hint ? ` (hint: ${hint})` : ''}: `),
    onError: (e) => { console.error('Telegram: ' + (e.errorMessage || e.message)); },
  });
  const groups = (await client.getDialogs({ limit: 300 }))
    .filter((d) => d.entity && (d.entity.className === 'Channel' || d.entity.className === 'Chat'))
    .map((d) => ({ title: d.title || String(d.entity.id), kind: d.entity.className === 'Channel' ? 'channel' : 'chat', id: String(d.entity.id), hash: d.entity.accessHash != null ? String(d.entity.accessHash) : '', what: d.entity.broadcast ? 'channel' : 'group' }));
  if (!groups.length) { console.error('No groups or channels found on this account.'); process.exit(1); }
  groups.forEach((g, i) => console.log(`${String(i + 1).padStart(3)}. ${g.title} (${g.what})`));
  const picked = (await ask('Which ones post the calls? Numbers separated by commas (up to 5): ')).split(',').map((x) => groups[Number(x.trim()) - 1]).filter(Boolean).slice(0, 5);
  if (!picked.length) { console.error('Nothing picked.'); process.exit(1); }
  const tgChat = picked.map((g) => (g.kind === 'channel' ? `channel:${g.id}:${g.hash}:${clean(g.title)}` : `chat:${g.id}:${clean(g.title)}`)).join(',');
  const key = randomBytes(24).toString('base64url');
  console.log(`
1) Vercel → your telegram-proxy project → Settings → Environment Variables (all "Sensitive"), then redeploy:

  TG_API_ID      ${apiId}
  TG_API_HASH    ${apiHash}
  TG_SESSION     ${client.session.save()}
  TG_CHAT        ${tgChat}
  TG_PROXY_KEY   ${key}

2) Cloudflare → your feed Worker → Settings → Variables and Secrets:

  TG_PROXY_URL   (text)    https://<your project>.vercel.app
  TG_PROXY_KEY   (secret)  ${key}
  TG_CHAT        (text)    ${tgChat}

Never paste the session anywhere else (not in chat, not in git).
To cut it off later: Telegram → Settings → Devices → end this session.`);
} finally {
  rl.close();
  await client.destroy().catch(() => {});
  process.exit(0);
}
