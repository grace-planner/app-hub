import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('settings show one shared Aliyun key field',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((html.match(/type="password"/g)||[]).length,1);
  assert.match(html,/name="aliyunKey"/);
  assert.doesNotMatch(html,/name="audioKey"|name="textKey"|id="aliyun-setup"/);
});
