export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// =============================================================
// カロリーレンズ 解析API（モード対応版 / 単位対応）
// mode = "package": 画像。バーコード優先 → 商品名検索 → 印字。
// mode = "eatout" : 画像。料理を見た目と量から推定（estimate）。
// mode = "home"   : 食材リスト(name + quantity + unit)。成分表ベースで計算（recipe）。
//                   単位は g / ml / 個 / 切れ / 枚 / 本 / 杯 / 大さじ / 小さじ など。
//                   個数・容量はAIが一般的な重量(g)に換算してから成分表で計算する。
// 出典(source)を保持して画面まで返す。
// barcode=確定 / official=公式検索 / label=印字 / recipe=成分表 / estimate=推定
// =============================================================

const BARCODE_PROMPT = [
'あなたは日本の食品の栄養成分データベースです。以下のJANコード(バーコード)の商品を特定し、公式な栄養成分(1パッケージ/内容量全量あたり)を返してください。',
'Google検索ツールで、このJANコードに対応する正式な商品名と、メーカー公式またはコンビニ公式の栄養成分表示(熱量kcal・たんぱく質・脂質・炭水化物)の実数値を確認してください。',
'JANコード: {CODE}',
'【厳守】公式値を確認できた場合のみ実数値を返す。記憶や推定で作らない。糖質+食物繊維は合算して炭水化物とする。100gあたり表示なら内容量から全量換算する。特定できない場合は found を false にする。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "found": true/false, "name": "商品名", "amount": "内容量", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } 数値は数字のみ小数1桁。'
].join('\n');

const NAME_PROMPT = [
'あなたは日本の食品の栄養成分データベースです。次の商品名の商品を特定し、メーカー公式またはコンビニ公式(セブン-イレブン/ローソン/ファミリーマート等)の栄養成分表示を返してください。',
'商品名: {NAME}',
'Google検索ツールで、この商品名に最も一致する正式な商品の公式栄養成分(1パッケージ/内容量全量あたり、熱量kcal・たんぱく質・脂質・炭水化物)を確認してください。',
'【厳守】公式の栄養成分表示が確認できた場合のみ、その実数値を返す。記憶や一般的な推定で数値を作らない。糖質と食物繊維が別記載なら合算して炭水化物とする。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "found": true/false, "name": "正式な商品名", "amount": "内容量", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 }',
'公式値が特定できない場合は found:false を返す。'
].join('\n');

const IMAGE_PACKAGE_PROMPT = [
'あなたは日本の食品の栄養成分に精通した管理栄養士です。写真のパッケージ商品の栄養情報(カロリーとPFC)を最も正確に返してください。Google検索ツールを使えます。',
'1. パッケージの正式な商品名を正確に読み取る。',
'2. その商品名でGoogle検索し、メーカー公式やコンビニ公式の栄養成分(熱量kcal・たんぱく質・脂質・炭水化物)を確認する。全項目そろえば source を "official"。',
'3. 写真に栄養成分表示が写っている場合は裏取りに使い、検索で取れない項目だけ印字値で補う。その場合 source を "label"。',
'4. 糖質+食物繊維は合算して炭水化物。基準量を確認し内容量から全量換算する。記憶や見た目の推定で公式値を上書きしない。',
'5. 複数の品があればすべて個別itemに。写っていない物は追加しない。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "items": [ { "name": "商品名", "amount": "量", "source": "official または label", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ] } 数値は数字のみ小数1桁。'
].join('\n');

const IMAGE_EATOUT_PROMPT = [
'あなたは日本の食品の栄養成分に精通した管理栄養士です。写真の外食・料理の栄養情報(カロリーとPFC)を、日本の一般的な実数値に近い現実的な値で推定してください。Google検索ツールを使えます。',
'1. 料理名を判定し、一般的な提供量・見た目の量からカロリーとPFCを推定する。チェーン店等で公式値が分かる場合は検索して使う。',
'2. 複数の品があればすべて個別itemに。写っていない物は追加しない。',
'3. source は、公式値を確認できたものは "official"、推定は "estimate"。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "items": [ { "name": "料理名", "amount": "量", "source": "official または estimate", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ] } 数値は数字のみ小数1桁。'
].join('\n');

const HOME_PROMPT = [
'あなたは日本食品標準成分表(八訂)に精通した管理栄養士です。以下の食材と分量から、各食材の栄養(カロリーとPFC)を成分表に基づき計算してください。Google検索ツールを使えます。',
'分量は単位付きで与えられます。単位は g(グラム)・ml(ミリリットル)・個・切れ・枚・本・杯・玉・パック・大さじ・小さじ などです。',
'食材リスト(JSON): {LIST}',
'【厳守】',
'1. g以外の単位(個・切れ・枚・本・杯・玉・パック・大さじ・小さじ等)は、その食材の一般的な1単位あたりの重量(g)に換算する。例: 卵1個=約50g(可食部)、鮭1切れ=約80g、食パン1枚(6枚切)=約60g、バナナ1本=約100g(可食部)、ごはん1杯=約150g。一般的な値を用いること。',
'2. ml(牛乳・豆乳・油・だし等)は、その液体の比重を考慮してg換算する。牛乳は約1.03、油は約0.92、水・だしは約1.0。',
'3. 換算後のグラム数で、日本食品標準成分表の「100gあたり」値から比例計算する。生・ゆで等で大きく変わる場合は一般的な調理状態を想定する。',
'4. 確認できない食材は最も近い一般的な食材で代用し、その旨を name に補足する。',
'5. amount には「入力された分量(換算後のg)」の形で記載する。例: "1個(約50g)"、"200g"、"200ml(約206g)"。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "items": [ { "name": "食材名", "amount": "分量", "source": "recipe", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ] } itemは入力食材ごとに1つ。数値は数字のみ小数1桁。'
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
let r, json;
  for (let __try = 0; __try < 3; __try++) {
    r = await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
contents: [{ parts: parts }],
tools: [{ google_search: {} }],
generationConfig: { temperature: 0 }
})
});
    json = await r.json();
    if (r.ok) break;
    const __msg = (json && json.error && json.error.message) ? json.error.message : ("HTTP " + r.status);
    const __quota = r.status === 429 || /quota|rate|exceeded|retry in/i.test(__msg);
    if (__quota && __try < 2) {
      let __wait = 8000;
      const __m = /retry in ([0-9.]+)s/i.exec(__msg);
      if (__m) __wait = Math.min(20000, (parseFloat(__m[1]) + 1) * 1000);
      await new Promise(function (res) { setTimeout(res, __wait); });
      continue;
    }
    throw new Error(__msg);
  }
let text = '';
if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
text = json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
}
return text;
}

function num(n) { return Number(n) || 0; }
function round1(n) { return Math.round(num(n) * 10) / 10; }

function normItems(rawItems, defaultSource) {
return (rawItems || []).map(function (it) {
return {
name: it.name || '不明',
amount: it.amount || '',
source: it.source || defaultSource,
kcal: Math.round(num(it.kcal)),
protein_g: round1(it.protein_g),
fat_g: round1(it.fat_g),
carbs_g: round1(it.carbs_g)
};
});
}

export default async function handler(req, res) {
if (req.method !== 'POST') {
return res.status(405).json({ error: 'POSTのみ対応しています' });
}
const body = req.body || {};
const mode = body.mode || 'package';
let image = body.image;
let imageMime = 'image/jpeg';
if (typeof image === 'string') {
  const mm = image.match(/^data:([^;,]+)[;,]/);
  if (mm && mm[1]) imageMime = mm[1];
  const ci = image.indexOf('base64,');
  if (ci !== -1) image = image.slice(ci + 7);
  image = image.replace(/\s/g, '');
}
const barcode = body.barcode;
const productName = (body.name != null) ? String(body.name).trim() : '';
const ingredients = body.ingredients;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
return res.status(500).json({ error: 'APIキーが設定されていません' });
}

try {
// ===== 自炊モード =====
if (mode === 'home') {
if (!ingredients || !ingredients.length) {
return res.status(400).json({ error: '食材が入力されていません' });
}
const list = ingredients.map(function (x) {
return { name: String(x.name || ''), quantity: num(x.quantity), unit: String(x.unit || 'g') };
});
const prompt = HOME_PROMPT.replace('{LIST}', JSON.stringify(list));
const text = await callGemini(apiKey, [{ text: prompt }]);
const data = extractJson(text);
if (!data || !data.items) {
return res.status(500).json({ error: '計算結果を読み取れませんでした。もう一度お試しください' });
}
return res.status(200).json({ items: normItems(data.items, 'recipe') });
}

// ===== パッケージ: バーコード確定 =====
if (mode === 'package' && barcode && /^[0-9]{8,14}$/.test(String(barcode))) {
try {
const prompt = BARCODE_PROMPT.replace('{CODE}', String(barcode));
const text = await callGemini(apiKey, [{ text: prompt }]);
const data = extractJson(text);
if (data && data.found === true && data.kcal) {
return res.status(200).json({
items: normItems([{
name: data.name, amount: data.amount, source: 'barcode',
kcal: data.kcal, protein_g: data.protein_g, fat_g: data.fat_g, carbs_g: data.carbs_g
}], 'barcode')
});
}
} catch (e) { /* 画像解析へフォールバック */ }
}

// ===== パッケージ: 商品名テキスト検索 =====
if (mode === 'package' && productName) {
  try {
    const prompt = NAME_PROMPT.replace('{NAME}', productName);
    const text = await callGemini(apiKey, [{ text: prompt }]);
    const data = extractJson(text);
    if (data && data.found === true && data.kcal) {
      return res.status(200).json({
        items: normItems([{
          name: data.name || productName, amount: data.amount, source: 'name',
          kcal: data.kcal, protein_g: data.protein_g, fat_g: data.fat_g, carbs_g: data.carbs_g
        }], 'name')
      });
    }
    return res.status(404).json({ error: '「' + productName + '」の公式の栄養成分が見つかりませんでした。商品名を正確に入力するか、写真で試してください。' });
  } catch (e) {
    return res.status(500).json({ error: '検索に失敗しました: ' + (e.message || '通信エラー') });
  }
}

// ===== 画像解析（パッケージ / 外食）=====
if (!image) {
return res.status(400).json({ error: '画像が送信されていません' });
}
const prompt = (mode === 'eatout') ? IMAGE_EATOUT_PROMPT : IMAGE_PACKAGE_PROMPT;
const defSource = (mode === 'eatout') ? 'estimate' : 'label';
const text = await callGemini(apiKey, [
{ text: prompt },
{ inline_data: { mime_type: imageMime, data: image } }
]);
if (!text) {
return res.status(500).json({ error: '食品を認識できませんでした。別の写真でお試しください' });
}
const data = extractJson(text);
if (!data || !data.items) {
return res.status(500).json({ error: '解析結果を読み取れませんでした。もう一度お試しください' });
}
return res.status(200).json({ items: normItems(data.items, defSource) });
} catch (err) {
return res.status(500).json({ error: '解析に失敗しました: ' + (err.message || '通信エラー') });
}
}
export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

// =============================================================
// カロリーレンズ 解析API（モード対応版 / 単位対応）
// mode = "package": 画像。バーコード優先 → 商品名検索 → 印字。
// mode = "eatout" : 画像。料理を見た目と量から推定（estimate）。
// mode = "home"   : 食材リスト(name + quantity + unit)。成分表ベースで計算（recipe）。
//                   単位は g / ml / 個 / 切れ / 枚 / 本 / 杯 / 大さじ / 小さじ など。
//                   個数・容量はAIが一般的な重量(g)に換算してから成分表で計算する。
// 出典(source)を保持して画面まで返す。
// barcode=確定 / official=公式検索 / label=印字 / recipe=成分表 / estimate=推定
// =============================================================

const BARCODE_PROMPT = [
'あなたは日本の食品の栄養成分データベースです。以下のJANコード(バーコード)の商品を特定し、公式な栄養成分(1パッケージ/内容量全量あたり)を返してください。',
'Google検索ツールで、このJANコードに対応する正式な商品名と、メーカー公式またはコンビニ公式の栄養成分表示(熱量kcal・たんぱく質・脂質・炭水化物)の実数値を確認してください。',
'JANコード: {CODE}',
'【厳守】公式値を確認できた場合のみ実数値を返す。記憶や推定で作らない。糖質+食物繊維は合算して炭水化物とする。100gあたり表示なら内容量から全量換算する。特定できない場合は found を false にする。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "found": true/false, "name": "商品名", "amount": "内容量", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } 数値は数字のみ小数1桁。'
].join('\n');

const IMAGE_PACKAGE_PROMPT = [
'あなたは日本の食品の栄養成分に精通した管理栄養士です。写真のパッケージ商品の栄養情報(カロリーとPFC)を最も正確に返してください。Google検索ツールを使えます。',
'1. パッケージの正式な商品名を正確に読み取る。',
'2. その商品名でGoogle検索し、メーカー公式やコンビニ公式の栄養成分(熱量kcal・たんぱく質・脂質・炭水化物)を確認する。全項目そろえば source を "official"。',
'3. 写真に栄養成分表示が写っている場合は裏取りに使い、検索で取れない項目だけ印字値で補う。その場合 source を "label"。',
'4. 糖質+食物繊維は合算して炭水化物。基準量を確認し内容量から全量換算する。記憶や見た目の推定で公式値を上書きしない。',
'5. 複数の品があればすべて個別itemに。写っていない物は追加しない。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "items": [ { "name": "商品名", "amount": "量", "source": "official または label", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ] } 数値は数字のみ小数1桁。'
].join('\n');

const IMAGE_EATOUT_PROMPT = [
'あなたは日本の食品の栄養成分に精通した管理栄養士です。写真の外食・料理の栄養情報(カロリーとPFC)を、日本の一般的な実数値に近い現実的な値で推定してください。Google検索ツールを使えます。',
'1. 料理名を判定し、一般的な提供量・見た目の量からカロリーとPFCを推定する。チェーン店等で公式値が分かる場合は検索して使う。',
'2. 複数の品があればすべて個別itemに。写っていない物は追加しない。',
'3. source は、公式値を確認できたものは "official"、推定は "estimate"。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "items": [ { "name": "料理名", "amount": "量", "source": "official または estimate", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ] } 数値は数字のみ小数1桁。'
].join('\n');

const HOME_PROMPT = [
'あなたは日本食品標準成分表(八訂)に精通した管理栄養士です。以下の食材と分量から、各食材の栄養(カロリーとPFC)を成分表に基づき計算してください。Google検索ツールを使えます。',
'分量は単位付きで与えられます。単位は g(グラム)・ml(ミリリットル)・個・切れ・枚・本・杯・玉・パック・大さじ・小さじ などです。',
'食材リスト(JSON): {LIST}',
'【厳守】',
'1. g以外の単位(個・切れ・枚・本・杯・玉・パック・大さじ・小さじ等)は、その食材の一般的な1単位あたりの重量(g)に換算する。例: 卵1個=約50g(可食部)、鮭1切れ=約80g、食パン1枚(6枚切)=約60g、バナナ1本=約100g(可食部)、ごはん1杯=約150g。一般的な値を用いること。',
'2. ml(牛乳・豆乳・油・だし等)は、その液体の比重を考慮してg換算する。牛乳は約1.03、油は約0.92、水・だしは約1.0。',
'3. 換算後のグラム数で、日本食品標準成分表の「100gあたり」値から比例計算する。生・ゆで等で大きく変わる場合は一般的な調理状態を想定する。',
'4. 確認できない食材は最も近い一般的な食材で代用し、その旨を name に補足する。',
'5. amount には「入力された分量(換算後のg)」の形で記載する。例: "1個(約50g)"、"200g"、"200ml(約206g)"。',
'【出力】説明やマークダウンを付けず、次のJSONのみ: { "items": [ { "name": "食材名", "amount": "分量", "source": "recipe", "kcal": 数値, "protein_g": 数値, "fat_g": 数値, "carbs_g": 数値 } ] } itemは入力食材ごとに1つ。数値は数字のみ小数1桁。'
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
let r, json;
  for (let __try = 0; __try < 3; __try++) {
    r = await fetch(url, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
contents: [{ parts: parts }],
tools: [{ google_search: {} }],
generationConfig: { temperature: 0 }
})
});
    json = await r.json();
    if (r.ok) break;
    const __msg = (json && json.error && json.error.message) ? json.error.message : ("HTTP " + r.status);
    const __quota = r.status === 429 || /quota|rate|exceeded|retry in/i.test(__msg);
    if (__quota && __try < 2) {
      let __wait = 8000;
      const __m = /retry in ([0-9.]+)s/i.exec(__msg);
      if (__m) __wait = Math.min(20000, (parseFloat(__m[1]) + 1) * 1000);
      await new Promise(function (res) { setTimeout(res, __wait); });
      continue;
    }
    throw new Error(__msg);
  }
let text = '';
if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
text = json.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
}
return text;
}

function num(n) { return Number(n) || 0; }
function round1(n) { return Math.round(num(n) * 10) / 10; }

function normItems(rawItems, defaultSource) {
return (rawItems || []).map(function (it) {
return {
name: it.name || '不明',
amount: it.amount || '',
source: it.source || defaultSource,
kcal: Math.round(num(it.kcal)),
protein_g: round1(it.protein_g),
fat_g: round1(it.fat_g),
carbs_g: round1(it.carbs_g)
};
});
}

export default async function handler(req, res) {
if (req.method !== 'POST') {
return res.status(405).json({ error: 'POSTのみ対応しています' });
}
const body = req.body || {};
const mode = body.mode || 'package';
let image = body.image;
let imageMime = 'image/jpeg';
if (typeof image === 'string') {
  const mm = image.match(/^data:([^;,]+)[;,]/);
  if (mm && mm[1]) imageMime = mm[1];
  const ci = image.indexOf('base64,');
  if (ci !== -1) image = image.slice(ci + 7);
  image = image.replace(/\s/g, '');
}
const barcode = body.barcode;
const ingredients = body.ingredients;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
return res.status(500).json({ error: 'APIキーが設定されていません' });
}

try {
// ===== 自炊モード =====
if (mode === 'home') {
if (!ingredients || !ingredients.length) {
return res.status(400).json({ error: '食材が入力されていません' });
}
const list = ingredients.map(function (x) {
return { name: String(x.name || ''), quantity: num(x.quantity), unit: String(x.unit || 'g') };
});
const prompt = HOME_PROMPT.replace('{LIST}', JSON.stringify(list));
const text = await callGemini(apiKey, [{ text: prompt }]);
const data = extractJson(text);
if (!data || !data.items) {
return res.status(500).json({ error: '計算結果を読み取れませんでした。もう一度お試しください' });
}
return res.status(200).json({ items: normItems(data.items, 'recipe') });
}

// ===== パッケージ: バーコード確定 =====
if (mode === 'package' && barcode && /^[0-9]{8,14}$/.test(String(barcode))) {
try {
const prompt = BARCODE_PROMPT.replace('{CODE}', String(barcode));
const text = await callGemini(apiKey, [{ text: prompt }]);
const data = extractJson(text);
if (data && data.found === true && data.kcal) {
return res.status(200).json({
items: normItems([{
name: data.name, amount: data.amount, source: 'barcode',
kcal: data.kcal, protein_g: data.protein_g, fat_g: data.fat_g, carbs_g: data.carbs_g
}], 'barcode')
});
}
} catch (e) { /* 画像解析へフォールバック */ }
}

// ===== 画像解析（パッケージ / 外食）=====
if (!image) {
return res.status(400).json({ error: '画像が送信されていません' });
}
const prompt = (mode === 'eatout') ? IMAGE_EATOUT_PROMPT : IMAGE_PACKAGE_PROMPT;
const defSource = (mode === 'eatout') ? 'estimate' : 'label';
const text = await callGemini(apiKey, [
{ text: prompt },
{ inline_data: { mime_type: imageMime, data: image } }
]);
if (!text) {
return res.status(500).json({ error: '食品を認識できませんでした。別の写真でお試しください' });
}
const data = extractJson(text);
if (!data || !data.items) {
return res.status(500).json({ error: '解析結果を読み取れませんでした。もう一度お試しください' });
}
return res.status(200).json({ items: normItems(data.items, defSource) });
} catch (err) {
return res.status(500).json({ error: '解析に失敗しました: ' + (err.message || '通信エラー') });
}
}
