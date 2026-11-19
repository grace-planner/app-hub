const fields = [
  'id', 'filename', 'meta', 'status', 'message', 'transcript', 'draft', 'trashedAt',
  'recordId', 'customer', 'manualQuery', 'matchChecked', 'matchCount', 'nameApproved',
  'nameDecisionMade', 'groupApproved', 'groupChoice', 'manualSelections', 'protection'
];
const snapshot = item => JSON.stringify(Object.fromEntries(fields.filter(name => Object.hasOwn(item, name)).map(name => [name, item[name]])));
const objectHost = 'grace-call-notes-audio-hz-7c4e.oss-cn-hangzhou.aliyuncs.com';
const cloudFilePrefix = 'aliyun-audio/';

export function makeCloudSync(address, token, fetcher = fetch) {
  const endpoint = new URL(address);
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.cn-hangzhou\.fcapp\.run$/.test(endpoint.hostname) ||
      endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw Error('请输入杭州云函数的 HTTPS 地址');
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('请输入云同步密钥');
  const request = async (route, method = 'GET', data) => {
    const headers = { Authorization: 'Bearer ' + token };
    if (data) headers['Content-Type'] = 'application/json';
    const response = await fetcher(endpoint.origin + route, {
      headers, method, body: data && JSON.stringify(data), redirect: 'error',
      cache: 'no-store', signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw Object.assign(new Error(detail.error || '云同步暂不可用'), { status: response.status });
    }
    return response.json();
  };
  function objectUrl(signed, id) {
    const url = new URL(signed);
    const parts = url.pathname.split('/');
    if (url.origin !== 'https://' + objectHost || url.username || url.password || parts.length !== 4 ||
        parts[1] !== 'recordings' || !/^[a-z0-9-]{1,48}$/.test(parts[2]) || parts[3] !== id) {
      throw Error('云端录音地址无效');
    }
    return url;
  }
  function applyRow(current, row) {
    const { record, revision, hasAudio } = row;
    const next = { ...current, ...record };
    for (const key of fields) if (!Object.hasOwn(record, key)) delete next[key];
    if (!current.file || current.file.startsWith(cloudFilePrefix)) {
      next.file = hasAudio && !current.sourceClearedAt ? cloudFilePrefix + record.id : null;
    }
    next.cloudSync = { endpoint: endpoint.origin, revision, baseline: snapshot(record) };
    if (current.cloudSync?.baseline !== next.cloudSync.baseline) {
      next.selectedItem = false;
      next.selectedAnalysis = false;
      next.selectedSave = false;
    }
    return next;
  }
  async function upload(id, source) {
    const route = '/audio/' + id;
    const planned = await request(route + '/upload', 'PUT');
    if (planned.row) return planned.row;
    const response = await fetcher(objectUrl(planned.url, id), {
      method: 'PUT', redirect: 'error',
      headers: { 'Content-Type': 'application/octet-stream', 'x-oss-forbid-overwrite': 'true' },
      body: source,
      signal: AbortSignal.timeout(240_000)
    });
    if (!response.ok && response.status !== 409) throw Error('录音未上传，将在下次同步时重试');
    return (await request(route + '/confirm', 'PUT')).row;
  }
  async function sync(items, readAudio) {
    const remote = new Map();
    let cursor;
    do {
      const page = await request('/records' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      for (const row of page.rows) remote.set(row.record.id, row);
      if (page.cursor && page.cursor === cursor) throw Error('云端返回了重复的分页位置');
      cursor = page.cursor;
    } while (cursor);
    const updated = [];
    let conflicts = 0;
    let pending = 0;
    for (const local of items) {
      const state = local.cloudSync;
      let row = remote.get(local.id);
      remote.delete(local.id);
      if (state?.endpoint !== endpoint.origin || ['processing', 'writing'].includes(local.status)) {
        if (row && state?.endpoint !== endpoint.origin) conflicts++;
        updated.push(local);
        continue;
      }
      try {
        const current = snapshot(local);
        const remoteSnapshot = row && snapshot(row.record);
        if (current !== state.baseline && current !== remoteSnapshot) {
          if (remoteSnapshot !== state.baseline && (row || state.revision)) {
            conflicts++;
            updated.push(local);
            continue;
          }
          row = await request('/records/' + local.id, 'PUT', {
            revision: row?.revision ?? 0, record: JSON.parse(current)
          });
        }
        if (row && !row.hasAudio && (row.audioExpiresAt === null || row.audioExpiresAt > Date.now() + 600_000) &&
            local.file && !local.file.startsWith(cloudFilePrefix)) {
          const source = await readAudio(local.file);
          if (source instanceof Blob) {
            try { row = await upload(local.id, source); } catch { pending++; }
          }
        }
        updated.push(row ? applyRow(local, row) : local);
      } catch (error) {
        if (error.status === 409) conflicts++;
        else pending++;
        updated.push(local);
      }
    }
    for (const row of remote.values()) updated.push(applyRow({}, row));
    return { items: updated.sort((a, b) => (a.meta?.epoch || 0) - (b.meta?.epoch || 0)), conflicts, pending };
  }
  async function download(id) {
    const signed = await request('/audio/' + id + '/download');
    const response = await fetcher(objectUrl(signed.url, id), {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(240_000)
    });
    if (!response.ok) throw Error('云端录音暂时无法下载');
    const blob = await response.blob();
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const actual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== id) throw Error('云端录音内容校验失败');
    return blob;
  }
  return { sync, download, endpoint: endpoint.origin };
}
