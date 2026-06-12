export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const PROMPT = [
  'あなたは日本の食品に非常に詳しいプロの管理栄養士です。',
  '与えられた写真を細部まで観察し、写っている食べ物・飲み物を一つずつ正確に特定してください。',
  '',
  '【最重要ルール】',
  '1. パッケージ、ラベル、包装に書かれた文字・商品名・ブランド名を最優先で読み取り、それを根拠に商品を特定すること。例: セブンイレブン、ローソン、ファミリーマート、明治、ザバス(SAVAS)、味の素 など。',
  '2. コンビニ商品やパッケージ商品は、読み取れた正式な商品名をそのまま name に使うこと。例:「スパイスキーマカレー(セブンイレブン)」「ザバス ミルクプロテイン」。',
  '3. 写真に複数の品がある場合は、すべて個別の item として列挙すること。まとめて1つにしない。',
  '4. 推測で写っていない料理を追加してはいけない。実際に見えるものだけを答える。',
  '5. 量(amount)は、見た目の大きさ・容器の表記(内容量ml/g)・個数から現実的に推定すること。',
  '6. カロリーと栄養素は、その商品・料理の一般的な実数値に基づき、量に応じて計算すること。日本の市販品は実際の市販栄養成分表示に近い値にすること。',
  '7. 文字が読めない料理は、見た目から最も可能性の高い具体的な料理名を答える(「食べ物」のような曖昧な語は避ける)。',
  '',
  '【出力形式】',
  '説明文やマークダウンは一切付けず、以下のJSONオブジェクトのみを出力すること。',
  '{',
  '  "items": [',
  '    { "name": "商品名または料理名", "amount": "量(例: 1個, 120g, 200ml, 1杯)", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 }',
  '  ],',
  '  "total_kcal": 全item合計カロリーの数値,',
  '  "protein_g": 全item合計タンパク質の数値,',
  '  "fat_g": 全item合計脂質の数値,',
  '  "carbs_g": 全item合計炭水化物の数値',
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
                          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
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

      function round(n) { return Math.round((Number(n) || 0) * 10) / 10; }
        data.total_kcal = Math.round(Number(data.total_kcal) || 0);
        data.protein_g = round(data.protein_g);
        data.fat_g = round(data.fat_g);
        data.carbs_g = round(data.carbs_g);
        data.items = data.items.map(function (it) {
                return {
                          name: it.name || '不明な食品',
                          amount: it.amount || '',
                          kcal: Math.round(Number(it.kcal) || 0)
                };
        });

      return res.status(200).json(data);
  } catch (err) {
        return res.status(500).json({ error: '通信エラーが発生しました。もう一度お試しください' });
  }
}
