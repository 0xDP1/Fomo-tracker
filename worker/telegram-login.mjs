// One-time login for the Telegram feed. Run it on your own computer (Node 22 or newer), never on a shared machine:
//   npm ci && node worker/telegram-login.mjs
// It asks for your api_id and api_hash (my.telegram.org → API development tools), your phone number, the code Telegram
// sends you and your two-step password if you have one, then lists your groups so you can pick the ones with calls.
// It prints the four values to put in Cloudflare and saves nothing. The session it prints is full access to your
// Telegram account: paste it only into Cloudflare's secret field. End it any time in Telegram → Settings → Devices.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { makeClient } from './telegram.mjs';

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
  console.log(`
Put these in Cloudflare → Workers & Pages → your feed Worker → Settings → Variables and Secrets.
Use "Secret" for the first three. Never paste the session anywhere else (not in chat, not in git).

  TG_API_ID    (secret)  ${apiId}
  TG_API_HASH  (secret)  ${apiHash}
  TG_SESSION   (secret)  ${client.session.save()}
  TG_CHAT      (text)    ${tgChat}

The Worker also needs the nodejs_compat compatibility flag and the Workers Paid plan (see worker/README.md).
To cut it off later: Telegram → Settings → Devices → end this session.`);
} finally {
  rl.close();
  await client.destroy().catch(() => {});
  process.exit(0);
}
