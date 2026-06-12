export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// =============================================================
// カロリーレンズ  解析API
// 正確性最優先の設計:
//   1) バーコード(JANコード)があれば商品を一意特定し公式値を確定取得
//   2) バーコードが無い/引けない場合のみ画像解析へフォールバック
//   3) 各itemに出典(source)を保持し、画面まで返す
//      barcode = バーコード照合(確定) / official = 公式検索 / label = 印字 / estimate = 推定
// =============================================================

const BARCODE_PROMPT = [
  'あなたは日本の食品の栄養成分データベースです。以下のJANコード(バーコード)の商品を特定し、その商品の公式な栄養成分(1パッケージ/内容量全量あたり)を返してください。',
  'あなたはGoogle検索ツールを使えます。必ず検索で、このJANコードに対応する正式な商品名と、メーカー公式またはコンビニ公式の栄養成分表示(熱量kcal・たんぱく質・脂質・炭水化物)の実数値を確認してください。',
  'JANコード: {CODE}',
  '',
  '【厳守ルール】',
  '1. 検索でJANコードまたは商品名から公式の栄養成分を確認できた場合のみ、その実数値を返す。記憶や推定で数値を作ってはいけない。',
  '2. 炭水化物が糖質と食物繊維に分かれている場合は合算して炭水化物とする。',
  '3. 基準量(100gあたり等)で表示されている場合は、内容量から実際に食べる全量に換算する。',
  '4. JANコードから商品を特定できない、または公式の栄養成分が確認できない場合は、found を false にする。数値をでっち上げない。',
  '',
  '【出力形式 - 厳守】説明やマークダウンを付けず、以下のJSONのみを出力する。',
  '{ "found": true または false, "name": "正式な商品名", "amount": "内容量(例: 1パック95g)", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 }',
  '数値は単位や記号を付けず数字のみ。小数は1桁まで。found が false の場合は他のフィールドは省略してよい。'
].join('\n');

const IMAGE_PROMPT = [
  'あなたは日本の食品の栄養成分に精通したプロの管理栄養士です。与えられた写真の食べ物・飲み物について、最も正確な栄養情報(カロリーとPFC)を返してください。',
  'あなたはGoogle検索ツールを使えます。正確性を最優先し、可能な限り検索で公式・信頼できる数値を確認してから回答してください。',
  '',
  '【最優先: 商品名を読んで検索する】',
  '1. 写真のパッケージ・ラベル・包装に商品名やブランド名(例: セブンイレブン、ローソン、ファミリーマート、明治、ザバス等)が写っている規格品の場合は、まずその正式な商品名を正確に読み取ること。',
  '2. 読み取った商品名でGoogle検索を行い、メーカー公式やコンビニ公式の栄養成分表示(熱量kcal・たんぱく質・脂質・炭水化物)の実数値を確認すること。これを最優先で信頼する。',
  '3. 検索で公式値が全項目そろった場合はそれをそのまま使い source を "official" とする。自分の記憶や見た目の推定で上書きしてはいけない。',
  '4. 写真に栄養成分表示(数値表)が写っている場合、それは検索結果の裏取りに使う。検索で取れない項目だけを印字値で補い、その項目を含むなら source を "label" とする。',
  '5. 炭水化物が糖質と食物繊維に分かれている場合は合算して炭水化物とする。基準量(1個/1袋/100gあたり等)を確認し内容量から実際に食べる全量に換算する。',
  '',
  '【商品が特定できない料理(外食・自炊)の場合】',
  '6. 商品名が特定できず公式値も無い料理の場合に限り、見た目と量から日本の一般的な現実的値を推定し source を "estimate" とする。',
  '7. 推定の場合でも、確実に分からない項目を断定しない。分かる範囲で最も現実的な値にする。',
  '',
  '【共通ルール】',
  '8. 写真に複数の品がある場合は、すべて個別のitemとして列挙する。まとめない。',
  '9. 写っていない料理を追加してはいけない。実際に見えるものだけを答える。',
  '10. 各itemには name, amount, source, kcal, protein_g, fat_g, carbs_g をすべて入れる。',
  '',
  '【出力形式 - 厳守】説明文やマークダウンを一切付けず、以下のJSONオブジェクトだけを出力する。',
  '{ "items": [ { "name": "商品名または料理名", "amount": "量", "source": "official または label または estimate", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ], "total_kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 }',
  '数値は単位や記号を付けず数字のみ。小数は1桁まで。'
].join('\n');

function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
  return null;
}

async function callGemini(apiKey, parts) {
  const model = 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: parts }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 }
    })
  });
  const json = await r.json();
  if (!r.ok) {
    const msg = (json && json.error && json.error.message) ? json.error.message : ('HTTP ' + r.status);
    throw new Error(msg);
  }
  let text = '';
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
    text = json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  }
  return text;
}

function num(n) { return Number(n) || 0; }
function round1(n) { return Math.round(num(n) * 10) / 10; }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTのみ対応しています' });
  }
  const image = req.body && req.body.image;
  const barcode = req.body && req.body.barcode;
  if (!image && !barcode) {
    return res.status(400).json({ error: '画像が送信されていません' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーが設定されていません' });
  }

  try {
    // --- 経路1: バーコードによる確定取得 ---
    if (barcode && /^[0-9]{8,14}$/.test(String(barcode))) {
      try {
        const prompt = BARCODE_PROMPT.replace('{CODE}', String(barcode));
        const text = await callGemini(apiKey, [{ text: prompt }]);
        const data = extractJson(text);
        if (data && data.found === true && data.kcal) {
          const item = {
            name: data.name || '不明な商品',
            amount: data.amount || '',
            source: 'barcode',
            kcal: Math.round(num(data.kcal)),
            protein_g: round1(data.protein_g),
            fat_g: round1(data.fat_g),
            carbs_g: round1(data.carbs_g)
          };
          return res.status(200).json({
            items: [{ name: item.name, amount: item.amount, source: item.source, kcal: item.kcal }],
            total_kcal: item.kcal,
            protein_g: item.protein_g,
            fat_g: item.fat_g,
            carbs_g: item.carbs_g
          });
        }
        // found=false のときは画像解析へフォールバック(画像がある場合)
      } catch (e) {
        // バーコード経路失敗 → 画像解析へフォールバック
      }
    }

    if (!image) {
      return res.status(500).json({ error: 'バーコードから商品を特定できませんでした。写真を撮って再度お試しください' });
    }

    // --- 経路2: 画像解析(商品名検索ファースト → 印字 → 推定) ---
    const text = await callGemini(apiKey, [
      { text: IMAGE_PROMPT },
      { inline_data: { mime_type: 'image/jpeg', data: image } }
    ]);
    if (!text) {
      return res.status(500).json({ error: '食品を認識できませんでした。別の写真でお試しください' });
    }
    const data = extractJson(text);
    if (!data || !data.items) {
      return res.status(500).json({ error: '解析結果を読み取れませんでした。もう一度お試しください' });
    }

    let items = (data.items || []).map(function (it) {
      return {
        name: it.name || '不明な食品',
        amount: it.amount || '',
        source: it.source || 'estimate',
        kcal: Math.round(num(it.kcal)),
        protein_g: round1(it.protein_g),
        fat_g: round1(it.fat_g),
        carbs_g: round1(it.carbs_g)
      };
    });

    function sum(key) { return items.reduce(function (a, it) { return a + num(it[key]); }, 0); }
    const out = {
      items: items.map(function (it) { return { name: it.name, amount: it.amount, source: it.source, kcal: it.kcal }; }),
      total_kcal: Math.round(sum('kcal')),
      protein_g: round1(sum('protein_g')),
      fat_g: round1(sum('fat_g')),
      carbs_g: round1(sum('carbs_g'))
    };
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: '解析に失敗しました: ' + (err.message || '通信エラー') });
  }
}
