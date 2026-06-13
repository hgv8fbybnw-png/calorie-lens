import { put } from '@vercel/blob';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

// =============================================================
// カロリーレンズ 画像保存API
// 端末ごとのフォルダ(deviceId)に写真を保存する。
// 受け取り: { deviceId, image(base64), mode }
// 保存パス: <deviceId>/<日時>-<ランダム>.jpg
// Privateストアに保存し、保存先URLを返す。
// =============================================================

function sanitizeId(id) {
  // フォルダ名に使える文字だけ許可(英数字とハイフン)。安全のため。
  var s = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return s || 'unknown-device';
}

function tsName() {
  var d = new Date();
  var p = function (n) { return ('0' + n).slice(-2); };
  var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  var rand = Math.random().toString(36).slice(2, 8);
  return stamp + '-' + rand + '.jpg';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTのみ対応しています' });
  }
  var body = req.body || {};
  var deviceId = sanitizeId(body.deviceId);
  var image = body.image;
  if (!image) {
    return res.status(400).json({ error: '画像が送信されていません' });
  }
  try {
    var buffer = Buffer.from(image, 'base64');
    var pathname = deviceId + '/' + tsName();
    var result = await put(pathname, buffer, {
      access: 'private',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      token: TOKEN
    });
    return res.status(200).json({ ok: true, url: result.url, pathname: result.pathname });
  } catch (err) {
    return res.status(500).json({ error: '保存に失敗しました: ' + (err.message || '通信エラー') });
  }
}
