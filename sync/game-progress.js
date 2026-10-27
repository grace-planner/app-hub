'use strict';

// 阿里云函数计算（Node.js 18+，事件函数 + HTTP 触发器）
// 单词乐园的进度存档：按同步口令把一份 JSON 存进 OSS。
// 不需要任何密钥：函数用自己绑定的角色（能读写下面这个存储桶）访问 OSS。

const BUCKET = process.env.BUCKET || 'oss-pai-beg84trywzih24ziga-cn-hangzhou';
const REGION = process.env.REGION || 'oss-cn-hangzhou';
const ORIGINS = ['https://grace-planner.github.io', 'http://localhost'];
const MAX_BYTES = 1024 * 1024;

const https = require('https');
const crypto = require('crypto');

function cors(origin) {
  const ok = ORIGINS.some(o => origin === o || origin.startsWith(o + ':'));
  return {
    'Access-Control-Allow-Origin': ok ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}
function respond(statusCode, body, origin) {
  return JSON.stringify({ statusCode, headers: cors(origin), body: JSON.stringify(body) });
}

// OSS REST API，V1 签名，带上角色的临时 token
function oss(cred, method, object, body) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const type = body ? 'application/json' : '';
    const headers = { Date: date, 'x-oss-security-token': cred.securityToken };
    const toSign = [method, '', type, date, 'x-oss-security-token:' + cred.securityToken, '/' + BUCKET + '/' + object].join('\n');
    headers.Authorization = 'OSS ' + cred.accessKeyId + ':' +
      crypto.createHmac('sha1', cred.accessKeySecret).update(toSign).digest('base64');
    if (body) { headers['Content-Type'] = type; headers['Content-Length'] = Buffer.byteLength(body); }
    const r = https.request({ hostname: BUCKET + '.' + REGION + '.aliyuncs.com', path: '/' + object, method, headers }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

exports.handler = async (event, context) => {
  let ev;
  try {
    const raw = Buffer.isBuffer(event) ? event.toString('utf8') : typeof event === 'string' ? event : JSON.stringify(event);
    ev = JSON.parse(raw);
  } catch (e) { return respond(400, { error: 'event parse error' }, ''); }

  const h = ev.headers || {};
  const origin = h.origin || h.Origin || '';
  const method = (ev.requestContext && ev.requestContext.http && ev.requestContext.http.method) || ev.httpMethod || '';
  if (method === 'OPTIONS') return respond(200, {}, origin);

  let body = {};
  try {
    let b = ev.body || '';
    if (ev.isBase64Encoded) b = Buffer.from(b, 'base64').toString('utf8');
    if (b) body = JSON.parse(b);
  } catch (e) { return respond(400, { error: 'bad json' }, origin); }

  const key = String(body.key || '');
  if (key.length < 6 || key.length > 100) return respond(400, { error: '口令要 6 到 100 个字' }, origin);
  const object = 'word-garden/progress/' + crypto.createHash('sha256').update(key).digest('hex') + '.json';
  const cred = context.credentials;
  if (!cred || !cred.accessKeyId) return respond(500, { error: '函数没有绑定角色' }, origin);

  try {
    if (body.action === 'load') {
      const r = await oss(cred, 'GET', object);
      if (r.status === 404) return respond(200, { data: null }, origin);
      if (r.status !== 200) return respond(502, { error: 'oss ' + r.status }, origin);
      return respond(200, { data: JSON.parse(r.body) }, origin);
    }
    if (body.action === 'save') {
      const data = JSON.stringify(body.data || {});
      if (Buffer.byteLength(data) > MAX_BYTES) return respond(413, { error: '存档太大' }, origin);
      const r = await oss(cred, 'PUT', object, data);
      if (r.status !== 200) return respond(502, { error: 'oss ' + r.status }, origin);
      return respond(200, { ok: true }, origin);
    }
    return respond(400, { error: 'unknown action' }, origin);
  } catch (e) {
    console.log('error', e.message);
    return respond(500, { error: e.message }, origin);
  }
};
