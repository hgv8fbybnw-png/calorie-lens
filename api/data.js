import { put, list } from '@vercel/blob';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

// =============================================================
// カロリーレンズ ユーザーデータ同期API
// 同期コード(syncCode)に紐づけて、目標(targets)と記録(log)を
// サーバー(Vercel Blob)に保存・取得する。複数端末で共有可能。
// action = 'load' : { code } -> { targets, log }
// action = 'save' : { code, targets, log } -> { ok: true }
// 認証情報は扱わない。コードは英数字のみに正規化して安全に扱う。
// =============================================================

function sanitizeCode(code) {
  var s = String(code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return s;
}

function pathFor(code) {
  return 'users/' + code + '.json';
}

async function readUser(code) {
  // listでprefix一致を探し、存在すればそのURLからfetchして読む
  var prefix = pathFor(code);
  var res = await list({ prefix: prefix, limit: 1 });
  if (!res || !res.blobs || !res.blobs.length) return null;
  var blob = res.blobs[0];
  if (blob.pathname !== prefix) return null;
  var r = await fetch(blob.url, { cache: 'no-store' });
  if (!r.ok) return null;
  try { return await r.json(); } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTのみ対応しています' });
  }
  var body = req.body || {};
  var action = body.action;
  var code = sanitizeCode(body.code);
  if (!code || code.length < 4) {
    return res.status(400).json({ error: '同期コードは4文字以上の英数字で入力してください' });
  }
  try {
    if (action === 'load') {
      var data = await readUser(code);
      if (!data) return res.status(200).json({ found: false, targets: {}, log: {} });
      return res.status(200).json({ found: true, targets: data.targets || {}, log: data.log || {} });
    }
    if (action === 'save') {
      var payload = {
        targets: body.targets || {},
        log: body.log || {},
        updatedAt: Date.now()
      };
      var json = JSON.stringify(payload);
      await put(pathFor(code), json, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true
      });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: '不正なアクションです' });
  } catch (err) {
    return res.status(500).json({ error: 'データ同期に失敗しました: ' + (err.message || '通信エラー') });
  }
}
