export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const PROMPT = [
'あなたは日本の食品表示と栄養計算に精通したプロの管理栄養士です。与えられた写真を細部まで観察し、最も正確な栄養情報を返してください。',
'',
'【最優先ルール: 栄養成分表示を読む】',
'1. 写真の中に「栄養成分表示」「栄養成分表」やそれに類する数値表(熱量/エネルギー kcal、たんぱく質、脂質、炭水化物 または 糖質+食物繊維)が写っている場合は、それを最優先で読み取り、その印字された実数値をそのまま使うこと。自分で推定してはいけない。',
'2. 成分表示には必ず基準量の記載がある(例: 「1個あたり」「1食あたり」「1袋あたり」「100gあたり」)。この基準量を必ず確認すること。',
'3. 基準が「100gあたり」など内容量と異なる場合は、パッケージ記載の内容量(g/ml)や個数を使って、その商品まるごと1パック分(実際に食べる全量)に換算すること。例: 100gあたり200kcalで内容量150gなら 300kcal。',
'4. 炭水化物が「糖質」と「食物繊維」に分かれて表示されている場合は、両者を合算して炭水化物とすること。',
'5. 数値が一部だけ読み取れる場合は、読み取れた値はその実数を使い、読み取れない項目のみ推定で補うこと。',
'',
'【成分表示が無い/読めない場合】',
'6. 成分表示が写真に無い、または完全に読めない場合に限り、商品名・ブランド名・料理の見た目・量から、日本の実際の市販栄養成分表示に近い現実的な値を推定すること。',
'7. パッケージ、ラベル、包装の商品名・ブランド名(例: セブンイレブン、ローソン、ファミリーマート、明治、ザバス)を読み取り、その商品の公式な栄養成分に基づいて推定すること。',
'',
'【共通ルール】',
'8. 写真に複数の品がある場合は、すべて個別のitemとして列挙すること。まとめて1つにしない。',
'9. 推測で写っていない料理を追加してはいけない。実際に見えるものだけを答える。',
'10. amountには対象の量を明記する(例: 1袋(150g), 1個, 200ml)。',
'11. 各itemには kcal, protein_g, fat_g, carbs_g をすべて入れること。',
'12. 栄養成分表示から読み取った場合は source を "label"、推定した場合は "estimate" とすること。',
'13. カロリーと三大栄養素の整合性: kcal は おおよそ protein_g*4 + fat_g*9 + carbs_g*4 になるはず。大きく矛盾する場合は読み取り/推定を見直すこと。',
'',
'【出力形式】',
'説明文やマークダウンは一切付けず、以下のJSONオブジェクトのみを出力すること。',
'{',
'  "items": [',
'    { "name": "商品名または料理名", "amount": "量", "source": "label または estimate", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 }',
'  ],',
'  "total_kcal": 全item合計カロリーの数値,',
'  "protein_g": 全item合計たんぱく質の数値,',
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
        generationConfig: { temperature: 0, topP: 0.95, responseMimeType: 'application/json' }
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
      if (it.source !== 'label') {
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
