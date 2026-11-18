import test from 'node:test';
import assert from 'node:assert/strict';
import {saveOrder} from '../core.js';

test('same-customer recordings save newest first',()=>{
  const ordered=saveOrder([
    {id:'old-a',recordId:'customer-a',meta:{epoch:100}},
    {id:'other',recordId:'customer-b',meta:{epoch:150}},
    {id:'new-a',recordId:'customer-a',meta:{epoch:200}},
  ]);
  assert.deepEqual(ordered.map(i=>i.id),['new-a','old-a','other']);
});

test('unlinked rows remain individually ordered',()=>{
  const ordered=saveOrder([{id:'one',meta:{epoch:100}},{id:'two',meta:{epoch:200}}]);
  assert.deepEqual(ordered.map(i=>i.id),['one','two']);
});
