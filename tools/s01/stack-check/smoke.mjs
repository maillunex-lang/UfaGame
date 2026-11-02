import Fastify from 'fastify';
import assert from 'node:assert/strict';
import {createElement, version as reactVersion} from 'react';
import pg from 'pg';
const app = Fastify();
app.post('/probe', {
  schema: {body: {type: 'object', required: ['seq'], additionalProperties: false,
    properties: {seq: {type: 'integer', minimum: 1}}}},
}, async request => ({seq: request.body.seq}));
try {
  const good = await app.inject({method: 'POST', url: '/probe', payload: {seq: 1}});
  assert.equal(good.statusCode, 200);
  assert.deepEqual(good.json(), {seq: 1});
  const bad = await app.inject({method: 'POST', url: '/probe', payload: {seq: -1}});
  assert.equal(bad.statusCode, 400);
  assert.equal(createElement('div', null, 'S01').type, 'div');
  assert.equal(typeof pg.Client, 'function');
  console.log(JSON.stringify({node: process.version, fastify: app.version,
    react: reactVersion, validation: '200/400 ok', pgImport: 'ok', productionApi: false}));
} finally {await app.close();}
