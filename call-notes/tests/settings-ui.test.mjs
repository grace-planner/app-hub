import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('settings show one shared Aliyun key field',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((html.match(/name="aliyunKey" type="password"/g)||[]).length,1);
  assert.match(html,/name="aliyunKey"/);
  assert.doesNotMatch(html,/name="audioKey"|name="textKey"|id="aliyun-setup"/);
});

test('calendar navigation and top review close control are present',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="nav-calendar"/);
  for(const mode of ['1','3','7','month'])assert.match(html,new RegExp(`data-calendar-mode="${mode}"`));
  assert.match(html,/id="close-review" class="dialog-close"/);
  assert.equal((html.match(/id="close-review"/g)||[]).length,1);
});
