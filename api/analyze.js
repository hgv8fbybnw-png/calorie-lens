export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTのみ対応' });
  }

  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: '画像がありません' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーが設定されていません' });
  }

  const prompt = `あなたは日本の食品に詳しい管理栄養士です。この写真に写っている食べ物・飲み物を正確に認識してください。
パッケージの文字やブランド名（例：セブンイレブン、ザバスSAVASなど）が読み取れる場合は必ず参考にし、商品名から正確に判断してください。
日本の定食・コンビニ商品・お菓子・飲料も正確に区別してください。
推測せず、写っているものだけを答えてください。写っていない料理を勝手に追加しないでください。

以下のJSON形式のみで返答してください（説明文やマークダウンは一切不要）:
{
  "items": [{"name": "食品名", "amount": "量(例:1個,120g,1杯)", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値}],
  "total_kcal": 合計カロリー数値,
  "protein_g": 合計タンパク質数値,
  "fat_g": 合計脂質数値,
  "carbs_g": 合計炭水化物数値
}`;

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: image } }
          ]
        }],
        generationConfig: { temperature:
