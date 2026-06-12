export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const PROMPT = [
'あなたは日本の食品の栄養成分に精通したプロの管理栄養士です。与えられた写真の食べ物・飲み物について、最も正確な栄養情報(カロリーとPFC)を返してください。',
'あなたはGoogle検索ツールを使えます。正確性を最優先し、可能な限り検索で公式・信頼できる数値を確認してから回答してください。',
'',
'【最優先: 商品名を読んで検索する】',
'1. 写真のパッケージ・ラベル・包装に商品名やブランド名(例: セブンイレブン、ローソン、ファミリーマート、明治、ザバス等)が写っている場合は、まずその正式な商品名を正確に読み取ること。例: 「ハンドDELI とろーりチーズチヂミ」。',
'2. 読み取った商品名でGoogle検索を行い、その商品の公式な栄養成分表示(熱量kcal、たんぱく質、脂質、炭水化物)の実数値を確認すること。メーカー公式サイトやセブン・ローソン等の公式情報を最優先で信頼する。',
'3. 検索で得られた公式の数値をそのまま使うこと。自分の記憶や見た目からの推定で上書きしてはいけない。',
'4. 炭水化物が糖質と食物繊維に分かれている場合は合算して炭水化物とする。',
'',
'【写真に栄養成分表示が写っている場合】',
'5. 写真内に栄養成分表示(数値表)が読み取れる場合は、その印字された実数値を最優先で使う。基準量(1個/1袋/100gあたり等)を確認し、内容量から実際に食べる全量に換算する。',
'',
'【商品が特定できない/検索で出ない場合】',
'6. 商品名が特定できない、または検索で公式値が見つからない料理(外食・自炊など)の場合に限り、料理の見た目と量から、日本の一般的な実数値に近い現実的な値を推定する。',
'',
'【共通ルール】',
'7. 写真に複数の品がある場合は、すべて個別のitemとして列挙する。まとめない。',
'8. 写っていない料理を追加してはいけない。実際に見えるものだけを答える。',
'9. 各itemには kcal, protein_g, fat_g, carbs_g をすべて入れる。',
'10. source は、公式値を検索で確認した場合は "official"、写真の成分表示から読んだ場合は "label"、推定した場合は "estimate" とする。',
'',
'【出力形式 - 厳守】',
'最終的な回答は、説明文やマークダウンを一切付けず、以下のJSONオブジェクトだけを出力すること。JSON以外の文字を出力しない。',
'{',
'  "items": [',
'    { "name": "商品名または料理名", "amount": "量", "source": "official または label または estimate", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 }',
'  ],',
'  "total_kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値',
'}',
'数値は単位や記号を付けず数字のみ。小数は1桁まで。'
].join('\n');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTのみ対応しています' });
  }
  const image = req.body && req.body.image;
  if (!image) {
    return res.status(400).json({ error: '画像が送信されていません' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーが設定されていません' });
  }

  const model = 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: 'image/jpeg', data: image } }
          ]
        }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0 }
      })
    });

    const json = await r.json();
    if (!r.ok) {
      const msg = (json && json.error && json.error.message) ? json.error.message : ('HTTP ' + r.status);
      return res.status(500).json({ error: '解析に失敗しました: ' + msg });
    }

    let text = '';
    if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
      text = json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
    }
    if (!text) {
      return res.status(500).json({ error: '食品を認識できませんでした。別の写真でお試しください' });
    }

    let data;
    try { data = JSON.parse(text); } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { data = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (!data || !data.items) {
      return res.status(500).json({ error: '解析結果を読み取れませんでした。もう一度お試しください' });
    }

    function num(n) { return Number(n) || 0; }
    function round1(n) { return Math.round(num(n) * 10) / 10; }

    let items = (data.items || []).map(function (it) {
      return {
        name: it.name || '不明な食品',
        amount: it.amount || '',
        source: it.source || 'estimate',
        kcal: num(it.kcal),
        protein_g: round1(it.protein_g),
        fat_g: round1(it.fat_g),
        carbs_g: round1(it.carbs_g)
      };
    });

    items = items.map(function (it) {
      const computed = it.protein_g * 4 + it.fat_g * 9 + it.carbs_g * 4;
      if (it.source === 'estimate') {
        if (!it.kcal && computed > 0) it.kcal = computed;
        else if (it.kcal && computed > 0 && Math.abs(it.kcal - computed) / it.kcal > 0.35) {
          it.kcal = Math.round((it.kcal + computed) / 2);
        }
      }
      it.kcal = Math.round(it.kcal);
      return it;
    });

    function sum(key) { return items.reduce(function (a, it) { return a + num(it[key]); }, 0); }
    const out = {
      items: items.map(function (it) { return { name: it.name, amount: it.amount, kcal: it.kcal }; }),
      total_kcal: Math.round(sum('kcal')),
      protein_g: round1(sum('protein_g')),
      fat_g: round1(sum('fat_g')),
      carbs_g: round1(sum('carbs_g'))
    };

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: '通信エラーが発生しました。もう一度お試しください' });
  }
}
