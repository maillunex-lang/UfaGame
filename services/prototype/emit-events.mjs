// Recorded server-output fixture only. No battle calculation or rewards.
import {writeFileSync} from 'node:fs';
const events = [100, 75, 40, 0].map((hp, i) => ({seq: i + 1, kind: 'hp', hp}));
writeFileSync(new URL('../../apps/game/prototype/events.json', import.meta.url), JSON.stringify(events, null, 2) + '\n');
