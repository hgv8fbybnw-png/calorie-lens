import { list, del } from '@vercel/blob';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

async function fetchBlob(b) {
  var url = b.downloadUrl || b.url;
  var r = await fetch(url, { cache: 'no-store', headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!r.ok) { r = await fetch(b.url, { cache: 'no-store' }); if (!r.ok) return null; }
  try { return await r.json(); } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST' || req.method === 'DELETE') {
      var body = req.body || {};
      var code = String(body.code || '').trim();
      if (!code) return res.status(400).json({ ok: false, error: 'code required' });
      var path = 'users/' + code + '.json';
      await del(path, { token: TOKEN });
      return res.status(200).json({ ok: true, deleted: code });
    }

    var out = [];
    var cursor = undefined;
    do {
      var resp = await list({ prefix: 'users/', limit: 1000, cursor: cursor, token: TOKEN });
      var blobs = (resp && resp.blobs) || [];
      for (var i = 0; i < blobs.length; i++) {
        var b = blobs[i];
        if (!/^users\/.+\.json$/.test(b.pathname)) continue;
        var code = b.pathname.replace(/^users\//, '').replace(/\.json$/, '');
        var data = await fetchBlob(b);
        if (!data) continue;
        out.push({ code: code, targets: data.targets || {}, log: data.log || {}, weight: data.weight || {}, workout: data.workout || {}, bodyfat: data.bodyfat || {}, muscle: data.muscle || {}, sleep: data.sleep || {}, measurements: data.measurements || {}, activityFactor: (data.activityFactor != null ? data.activityFactor : null), bodyPhotos: data.bodyPhotos || [], updatedAt: data.updatedAt || 0 });
      }
      cursor = resp && resp.cursor;
    } while (cursor);
    out.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return res.status(200).json({ ok: true, users: out });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err && err.message) || 'error' });
  }
}
