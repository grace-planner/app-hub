const scope = 'https://www.googleapis.com/auth/drive.file';
const clientId = '460730595893-00akksijvsifeh1r18vsmpb85l301ch5.apps.googleusercontent.com';
const base = 'https://www.googleapis.com';
const namespace = 'call-notes-text-v1';
const folderName = '通话跟进 · 文字同步';
const folderType = 'application/vnd.google-apps.folder';
const fields = [
  'id', 'filename', 'meta', 'status', 'message', 'transcript', 'draft', 'trashedAt',
  'recordId', 'customer', 'matchChecked', 'matchCount', 'nameApproved', 'nameDecisionMade',
  'groupApproved', 'groupChoice', 'manualSelections', 'protection'
];
const transient = new Set(['processing', 'writing']);
const idPattern = /^[a-f0-9]{64}$/;
const fileIdPattern = /^[A-Za-z0-9_-]+$/;
const snapshot = item => JSON.stringify(Object.fromEntries(fields.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])));

// Drive properties store one extra parent per key, keeping old single-parent revisions readable.
const mergeParentKeys = Array.from({length: 24}, (_, index) => 'merge' + index);
const mergeParents = props => mergeParentKeys.map(key => props[key]).filter(version => idPattern.test(version || ''));
const toVersion = file => {
  const {version, parent, writer} = file.appProperties;
  return {id: file.id, version, parent, writer, merged: mergeParents(file.appProperties)};
};
function recordHeads(files) {
  const versions = new Map(files.map(file => [file.appProperties.version, toVersion(file)]));
  const ancestors = new Set([...versions.values()].flatMap(row => [row.parent, ...row.merged]));
  return [...versions.values()].filter(row => !ancestors.has(row.version))
    .sort((a, b) => a.version.localeCompare(b.version));
}
function ownContinuations(heads, files, baseVersion, writer) {
  if (!writer || !heads.length || heads.some(head => head.version === baseVersion)) return false;
  const versions = new Map(files.map(file => [file.appProperties.version, toVersion(file)]));
  return heads.every(head => {
    const seen = new Set();
    let current = head;
    while (current?.writer === writer && !current.merged.length && !seen.has(current.version)) {
      if ((current.parent || '') === baseVersion) return true;
      seen.add(current.version);
      current = versions.get(current.parent);
    }
    return false;
  });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const sameText = (first, second) => first === second ||
  (!!first && !!second && JSON.stringify(canonical(JSON.parse(first))) === JSON.stringify(canonical(JSON.parse(second))));
const revisionContent = (text, parent, merged = []) =>
  new Blob([parent || '', '\n', ...merged.map(version => version + '\n'), text]);
const localIdentity = item => item && JSON.stringify([snapshot(item), item.driveText || null]);


export function requestDriveToken(signal = AbortSignal.timeout(45_000)) {
  return new Promise((resolve, reject) => {
    const oauth = globalThis.google?.accounts?.oauth2;
    if (!oauth) return reject(Error('Google 登录未加载，请检查网络后刷新页面'));
    signal.throwIfAborted();
    let finished = false;
    function finish(error, token) {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(token);
    }
    function abort() { finish(signal.reason); }
    signal.addEventListener('abort', abort, {once:true});
    try {
      oauth.initTokenClient({
        client_id: clientId,
        scope,
        include_granted_scopes: false,
        callback: response => {
          if (finished) return;
          if (!response.access_token || !oauth.hasGrantedAllScopes(response, scope)) {
            finish(Error('Google Drive 未授权'));
          } else {
            finish(null, response.access_token);
          }
        },
        error_callback: error => finish(Error(error.type === 'popup_closed'
          ? 'Google 登录窗口已关闭，请重新连接'
          : '无法打开 Google 登录窗口，请允许弹窗后重试'))
      }).requestAccessToken({ prompt: 'select_account' });
    } catch (error) {
      finish(error);
    }
  });
}

export function canEnrollDriveText(item) {
  return !item.driveText && !item.trashedAt && !transient.has(item.status) &&
    idPattern.test(item.id) && !!item.meta && typeof item.transcript === 'string' && !!item.transcript.trim();
}

export async function makeDriveTextSync(token, hash, fetcher = fetch, initialSignal, writer) {
  let operationSignal = initialSignal;
  const request = async (step, path, options = {}) => {
    operationSignal?.throwIfAborted();
    const requestDeadline = AbortSignal.timeout(15_000);
    let response;
    try {
      response = await fetcher(base + path, {
        ...options,
        headers: { Authorization: 'Bearer ' + token, ...options.headers },
        cache: 'no-store',
        redirect: 'error',
        signal: operationSignal ? AbortSignal.any([operationSignal, requestDeadline]) : requestDeadline
      });
    } catch (error) {
      operationSignal?.throwIfAborted();
      throw Object.assign(new Error(`Google Drive ${step}失败（${error.name === 'TimeoutError' ? '请求超时' : '浏览器网络请求失败'}）`, {cause:error}), {code:'DRIVE_NETWORK'});
    }
    if (!response.ok) {
      throw Object.assign(Error(response.status === 401 ? 'Google 登录已过期，请重新连接' :
        `Google Drive ${step}失败（${response.status}）`), { status: response.status });
    }
    return response;
  };
  const account = (await (await request('读取账号', '/drive/v3/about?fields=user(permissionId)')).json()).user?.permissionId;
  if (!fileIdPattern.test(account || '')) throw Error('无法识别 Google Drive 账号');
  operationSignal = undefined;

  async function list(parentFilter = "") {
    const files = [];
    const params = new URLSearchParams({
      q: `trashed = false and 'me' in owners and appProperties has { key='app' and value='${namespace}' }${parentFilter}`,
      fields: 'nextPageToken,incompleteSearch,files(id,mimeType,parents,shared,appProperties)',
      corpora: 'user',
      pageSize: '100'
    });
    do {
      const page = await (await request('读取同步列表', '/drive/v3/files?' + params)).json();
      if (page.incompleteSearch || (page.nextPageToken && page.nextPageToken === params.get('pageToken'))) {
        throw Error('Drive 文件列表不完整，请重试');
      }
      files.push(...(page.files || []));
      if (!page.nextPageToken) break;
      params.set('pageToken', page.nextPageToken);
    } while (true);
    return files.filter(file => fileIdPattern.test(file.id || ''));
  }

  async function resolveFolder(files) {
    const folders = files.filter(file => file.mimeType === folderType &&
      file.appProperties?.kind === 'folder' && !file.shared);
    if (folders.length) return folders.map(file => file.id).sort()[0];
    const response = await request('创建同步文件夹', '/drive/v3/files?ignoreDefaultVisibility=true&fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName, mimeType: folderType,
        appProperties: { app: namespace, kind: 'folder' }
      })
    });
    const { id } = await response.json();
    if (!fileIdPattern.test(id || '')) throw Error('Drive 同步文件夹 ID 无效');
    return id;
  }

  async function moveRootFiles(files, folder) {
    const candidates = files.filter(file => file.parents?.length === 1 && !file.shared && file.parents[0] !== folder);
    if (!candidates.length) return 0;
    const rootFiles = new Map((await list(" and 'root' in parents")).map(file => [file.id, file]));
    let moved = 0;
    for (const file of candidates) {
      const rootFile = rootFiles.get(file.id);
      if (!rootFile || rootFile.shared || rootFile.parents?.[0] !== file.parents[0]) continue;
      const params = new URLSearchParams({ addParents: folder, removeParents: rootFile.parents[0], fields: 'id' });
      await request('整理已有转写', '/drive/v3/files/' + encodeURIComponent(file.id) + '?' + params, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      moved++;
    }
    return moved;
  }

  async function upload(folder, record, content, versions) {
    const boundary = 'call-notes-' + crypto.randomUUID();
    const metadata = { name: '通话跟进-' + record + '.json', parents: [folder], appProperties: { app: namespace, record, ...versions, ...(writer && {writer}) } };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      content,
      `\r\n--${boundary}--\r\n`
    ]);
    const response = await request('上传转写', '/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST', body, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }
    });
    return (await response.json()).id;
  }

  const recordFiles = files => files.filter(({ appProperties: props, mimeType }) =>
    mimeType !== folderType && idPattern.test(props?.record || '') &&
    idPattern.test(props.version || '') && (!props.parent || idPattern.test(props.parent)));
  const deletionIds = files => new Set(files.filter(({ appProperties: props, mimeType }) =>
    mimeType !== folderType && props?.kind === 'deleted' && idPattern.test(props.record || ''))
    .map(file => file.appProperties.record));

  async function trashVersions(records) {
    for (const file of records) {
      await request('清理转写副本', '/drive/v3/files/' + encodeURIComponent(file.id) + '?fields=id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true })
      });
    }
  }

  async function clearTrash(items) {
    const files = await list();
    const deleted = deletionIds(files);
    const records = recordFiles(files);
    for (const item of items) {
      if (!item.trashedAt || item.driveText?.account !== account || !idPattern.test(item.id)) {
        throw Error('这条记录无法从当前 Google Drive 回收站清理。');
      }
      if (deleted.has(item.id)) continue;
      const versions = records.filter(file => file.appProperties.record === item.id);
      const heads = recordHeads(versions);
      if (heads.some(head => head.version !== item.driveText.version)) {
        throw Error('其他设备有更新或冲突，请先同步并核对后再清空回收站。');
      }
    }
    let folder;
    for (const item of items) {
      if (deleted.has(item.id)) continue;
      folder ??= await resolveFolder(files);
      await request('记录回收站清理', '/drive/v3/files?ignoreDefaultVisibility=true&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '通话跟进-删除-' + item.id,
          parents: [folder],
          appProperties: { app: namespace, kind: 'deleted', record: item.id }
        })
      });
      deleted.add(item.id);
    }
    const ids = new Set(items.map(item => item.id));
    await trashVersions(records.filter(file => ids.has(file.appProperties.record)));
  }

  const downloadFile = id => request('下载转写', '/drive/v3/files/' + encodeURIComponent(id) + '?alt=media');
  async function readVersion(id, head) {
    const record = await (await downloadFile(head.id)).json();
    if (record.id !== id || typeof record.filename !== 'string' || typeof record.transcript !== 'string' ||
        !record.transcript || !record.meta || typeof record.status !== 'string' || transient.has(record.status)) {
      throw Error('Drive 转写记录内容无效');
    }
    const remote = snapshot(record);
    if (await hash(revisionContent(remote, head.parent, head.merged)) !== head.version) throw Error('Drive 转写记录校验失败');
    return remote;
  }

  async function inspectConflict({id, heads}) {
    const versions = [];
    for (const head of heads) versions.push(JSON.parse(await readVersion(id, head)));
    return versions;
  }

  function appliedVersion(item, text, version) {
    const record = JSON.parse(text);
    const next = { ...item, ...record, selectedItem: false, selectedAnalysis: false, selectedSave: false,
      driveText: { account, version, baseline: text } };
    for (const key of fields) if (!Object.hasOwn(record, key)) delete next[key];
    return next;
  }

  async function mergeVersions(files, id, heads, text) {
    const [parent, ...merged] = heads.map(head => head.version);
    if (merged.length > mergeParentKeys.length) throw Error('云端版本过多，暂时无法合并。');
    const version = await hash(revisionContent(text, parent, merged));
    const links = Object.fromEntries(merged.map((value, index) => [mergeParentKeys[index], value]));
    await upload(await resolveFolder(files), id, text, {version, ...(parent && {parent}), ...links});
    return version;
  }

  async function resolveConflict({conflict, current, choice}) {
    const {id, heads} = conflict;
    const stale = () => Error('这条记录的版本已更新，请点「立即同步」后重新核对。');
    if (!idPattern.test(id) || localIdentity(current) !== conflict.localIdentity ||
        (current?.driveText && current.driveText.account !== account)) throw stale();
    const checkHeads = async () => {
      const files = await list();
      const active = recordHeads(recordFiles(files).filter(file => file.appProperties.record === id));
      if (deletionIds(files).has(id) || active.map(head => head.version).join() !== heads.map(head => head.version).join()) {
        throw stale();
      }
      return {files, active};
    };
    const {active} = await checkHeads();
    const selected = active.find(head => head.version === choice);
    const text = choice === 'local' && current?.transcript?.trim() ? snapshot(current)
      : selected ? await readVersion(id, selected) : null;
    if (!text || transient.has(current?.status)) throw stale();
    if (active.length === 1 && selected) {
      await checkHeads();
      return appliedVersion(current, text, selected.version);
    }
    if (active.length === 1 && sameText(text, await readVersion(id, active[0]))) {
      await checkHeads();
      return appliedVersion(current, text, active[0].version);
    }
    const {files} = await checkHeads();
    return appliedVersion(current, text, await mergeVersions(files, id, active, text));
  }

  async function sync(items) {
    const available = await list();
    const deleted = deletionIds(available);
    const allRecords = recordFiles(available);
    await trashVersions(allRecords.filter(file => deleted.has(file.appProperties.record)));
    const records = allRecords.filter(file => !deleted.has(file.appProperties.record));
    let folder;
    if (records.length) folder = await resolveFolder(available);
    const moved = folder ? await moveRootFiles(records, folder) : 0;
    const histories = new Map();
    for (const file of records) {
      const {record} = file.appProperties;
      if (!histories.has(record)) histories.set(record, []);
      histories.get(record).push(file);
    }
    const local = new Map(items.map(item => [item.id, item]));
    const removed = items.filter(item => item.driveText?.account === account &&
      (item.driveText.version || item.trashedAt) && deleted.has(item.id));
    const result = new Map(local);
    for (const item of removed) result.delete(item.id);
    const conflictDetails = [];
    let uploaded = 0;
    let downloaded = 0;
    const eligible = items.filter(item => item.driveText?.account === account && idPattern.test(item.id));
    for (const id of new Set([...histories.keys(), ...eligible.map(item => item.id)])) {
      if (deleted.has(id)) continue;
      const item = local.get(id);
      let state = item?.driveText;
      if (item && (transient.has(item.status) || (state && state.account !== account))) continue;
      const history = histories.get(id) || [];
      const heads = recordHeads(history);
      const conflict = () => conflictDetails.push({id, item, heads, localIdentity: localIdentity(item)});
      let head = heads[0];
      let text = item && snapshot(item);
      if (item?.transcript && state && ownContinuations(heads, history, state.version, writer)) {
        if (heads.length > 1) {
          const version = await mergeVersions(available, id, heads, text);
          result.set(id, appliedVersion(item, text, version));
          uploaded++;
          continue;
        }
        state = {...state, version: head.version, baseline: await readVersion(id, head)};
      }
      if (heads.length > 1) {
        const matching = await readVersion(id, head);
        if (item?.transcript && (!state || !sameText(text, state.baseline)) && !sameText(text, matching)) {
          conflict();
          continue;
        }
        let identical = true;
        for (const candidate of heads.slice(1)) {
          if (!sameText(matching, await readVersion(id, candidate))) {
            identical = false;
            break;
          }
        }
        if (!identical) { conflict(); continue; }
        const version = await mergeVersions(available, id, heads, matching);
        result.set(id, appliedVersion(item, matching, version));
        uploaded++;
        continue;
      }
      if (item?.transcript && state && !sameText(text, state.baseline)) {
        const version = await hash(revisionContent(text, state.version));
        if (head?.version !== version) {
          if ((head?.version || '') !== state.version) {
            const remote = head && await readVersion(id, head);
            if (!sameText(text, remote)) { conflict(); continue; }
            text = remote;
            downloaded++;
          } else {
            folder ??= await resolveFolder(available);
            await upload(folder, id, text, { version, ...(state.version && { parent: state.version }) });
            uploaded++;
            head = { version };
          }
        }
      } else if (head && head.version !== state?.version) {
        const remote = await readVersion(id, head);
        if (item?.transcript && !state && !sameText(text, remote)) { conflict(); continue; }
        text = remote;
        downloaded++;
      }
      if (!head || !text || head.version === item?.driveText?.version) continue;
      result.set(id, appliedVersion(item, text, head.version));
    }
    return { items: [...result.values()], conflicts: conflictDetails.length, conflictDetails, uploaded, downloaded, moved, removed };
  }

  async function run(work, items, signal) {
    operationSignal = signal;
    try {
      signal?.throwIfAborted();
      const result = await work(items);
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      operationSignal = undefined;
    }
  }
  return {
    account,
    sync: (items, signal) => run(sync, items, signal),
    inspectConflict: (conflict, signal) => run(inspectConflict, conflict, signal),
    resolveConflict: (conflict, current, choice, signal) => run(resolveConflict, {conflict, current, choice}, signal),
    clearTrash: (items, signal) => run(clearTrash, items, signal)
  };
}
