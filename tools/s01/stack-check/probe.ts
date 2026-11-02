import Fastify from 'fastify';
const app = Fastify();
app.get<{Reply: {ok: boolean}}>('/health', async () => ({ok: true}));
await app.ready();
await app.close();
