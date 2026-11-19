const scope = 'https://www.googleapis.com/auth/drive.file';
const clientId = '460730595893-00akksijvsifeh1r18vsmpb85l301ch5.apps.googleusercontent.com';
const base = 'https://www.googleapis.com';
const namespace = 'call-notes-text-v1';
const fields = [
  'id', 'filename', 'meta', 'status', 'message', 'transcript', 'draft', 'trashedAt',
  'recordId', 'customer', 'matchChecked', 'matchCount', 'nameApproved', 'nameDecisionMade',
  'groupApproved', 'groupChoice', 'manualSelections', 'protection'
];
const transient = new Set(['processing', 'writing']);
const idPattern = /^[a-f0-9]{64}$/;
const fileIdPattern = /^[A-Za-z0-9_-]+$/;
const snapshot = item => JSON.stringify(Object.fromEntries(fields.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])));

export function requestDriveToken() {
  return new Promise((resolve, reject) => {
    const oauth = globalThis.google?.accounts?.oauth2;
    if (!oauth) return reject(Error('Google 登录未加载，请检查网络后刷新页面'));
    oauth.initTokenClient({
      client_id: clientId,
      scope,
      include_granted_scopes: false,
      callback: response => {
        if (!response.access_token || !oauth.hasGrantedAllScopes(response, scope)) {
          reject(Error('Google Drive 未授权'));
        } else {
          resolve(response.access_token);
        }
      },
      error_callback: () => reject(Error('Google 登录窗口未完成，请重试'))
    }).requestAccessToken({ prompt: 'select_account' });
  });
}

export async function makeDriveTextSync(token, hash, fetcher = fetch) {
  const request = async (path, options = {}) => {
    const response = await fetcher(base + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, ...options.headers },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      throw Object.assign(Error(response.status === 401 ? 'Google 登录已过期，请重新连接' :
        `Google Drive 请求失败（${response.status}）`), { status: response.status });
    }
    return response;
  };
  const account = (await (await request('/drive/v3/about?fields=user(permissionId)')).json()).user?.permissionId;
  if (!fileIdPattern.test(account || '')) throw Error('无法识别 Google Drive 账号');

  async function list() {
    const files = [];
    const params = new URLSearchParams({
      q: `trashed = false and 'me' in owners and appProperties has { key='app' and value='${namespace}' }`,
      fields: 'nextPageToken,incompleteSearch,files(id,appProperties)',
      corpora: 'user',
      pageSize: '100'
    });
    do {
      const page = await (await request('/drive/v3/files?' + params)).json();
      if (page.incompleteSearch || (page.nextPageToken && page.nextPageToken === params.get('pageToken'))) {
        throw Error('Drive 文件列表不完整，请重试');
      }
      files.push(...(page.files || []));
      if (!page.nextPageToken) break;
      params.set('pageToken', page.nextPageToken);
    } while (true);
    return files.filter(file => fileIdPattern.test(file.id) && idPattern.test(file.appProperties?.record || ''));
  }

  async function upload(record, content, versions) {
    const boundary = 'call-notes-' + crypto.randomUUID();
    const metadata = { name: '通话跟进-' + record + '.json', appProperties: { app: namespace, record, ...versions } };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      content,
      `\r\n--${boundary}--\r\n`
    ]);
    const response = await request('/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }
    });
    return (await response.json()).id;
  }

  const downloadFile = id => request('/drive/v3/files/' + encodeURIComponent(id) + '?alt=media');
  async function sync(items) {
    const histories = new Map();
    for (const file of await list()) {
      const { record, version, parent } = file.appProperties;
      if (!idPattern.test(version || '') || (parent && !idPattern.test(parent))) continue;
      if (!histories.has(record)) histories.set(record, new Map());
      histories.get(record).set(version, { id: file.id, version, parent });
    }
    const local = new Map(items.map(item => [item.id, item]));
    const result = new Map(local);
    let conflicts = 0;
    const eligible = items.filter(item => item.driveText?.account === account && idPattern.test(item.id));
    for (const id of new Set([...histories.keys(), ...eligible.map(item => item.id)])) {
      const item = local.get(id);
      const state = item?.driveText;
      if (item && (transient.has(item.status) || (state && state.account !== account))) continue;
      const versions = [...(histories.get(id)?.values() || [])];
      const ancestors = new Set(versions.map(row => row.parent));
      const heads = versions.filter(row => !ancestors.has(row.version));
      if (heads.length > 1) { conflicts++; continue; }
      let head = heads[0];
      let text = item && snapshot(item);
      if (item?.transcript && state && text !== state.baseline) {
        if ((head?.version || '') !== state.version) { conflicts++; continue; }
        const version = await hash(new Blob([state.version, '\n', text]));
        await upload(id, text, { version, ...(state.version && { parent: state.version }) });
        head = { version };
      } else if (head && head.version !== state?.version) {
        const record = await (await downloadFile(head.id)).json();
        if (record.id !== id || typeof record.filename !== 'string' || typeof record.transcript !== 'string' ||
            !record.transcript || !record.meta || typeof record.status !== 'string' || transient.has(record.status)) {
          throw Error('Drive 转写记录内容无效');
        }
        const remote = snapshot(record);
        if (await hash(new Blob([head.parent || '', '\n', remote])) !== head.version) throw Error('Drive 转写记录校验失败');
        if (item?.transcript && !state && text !== remote) { conflicts++; continue; }
        text = remote;
      }
      if (!head || !text || head.version === state?.version) continue;
      const record = JSON.parse(text);
      const next = { ...item, ...record, selectedItem: false, selectedAnalysis: false, selectedSave: false,
        driveText: { account, version: head.version, baseline: text } };
      for (const key of fields) if (!Object.hasOwn(record, key)) delete next[key];
      result.set(id, next);
    }
    return { items: [...result.values()], conflicts };
  }

  return { account, sync };
}
