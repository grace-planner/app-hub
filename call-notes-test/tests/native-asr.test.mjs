import test from 'node:test';
import assert from 'node:assert/strict';
import {aliyunAudioBase,aliyunASRRequest,aliyunTranscript} from '../core.js';

test('migrates the old compatible URL to the native API base',()=>{
  assert.equal(aliyunAudioBase('https://dashscope.aliyuncs.com/compatible-mode/v1'),'https://dashscope.aliyuncs.com/api/v1');
});

test('keeps a workspace-specific native API base',()=>{
  assert.equal(aliyunAudioBase('https://ws123.cn-beijing.maas.aliyuncs.com/api/v1/'),'https://ws123.cn-beijing.maas.aliyuncs.com/api/v1');
});

test('builds the Qwen Audio native request',()=>{
  const {url,options}=aliyunASRRequest('https://dashscope.aliyuncs.com/api/v1','qwen-audio-3.1-asr-flash','data:audio/wav;base64,AAAA','test-key');
  assert.equal(url,'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(options.headers['X-DashScope-SSE'],'disable');
  assert.equal(options.headers.Authorization,'Bearer test-key');
  const body=JSON.parse(options.body);
  assert.equal(body.model,'qwen-audio-3.1-asr-flash');
  assert.equal(body.input.messages[0].content[0].input_audio.data,'data:audio/wav;base64,AAAA');
  assert.deepEqual(body.parameters,{format:'wav',sample_rate:'16000',language_hints:['zh','en']});
});

test('reads native output.text and rejects incompatible responses',()=>{
  assert.equal(aliyunTranscript({output:{text:' A-Level 课程 '}}),'A-Level 课程');
  assert.throws(()=>aliyunTranscript({choices:[]}),/原生接口未返回完整/);
});
