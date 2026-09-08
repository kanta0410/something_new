# 転生クオンツ / ISEKAI QUANT — 設計書

> 人生はゲーム。死は終わりではない。スキルを持って転生し、また賭けろ。

単一 HTML で動くローグライク人生シミュレーター。1ターン = 1年。
中身は本物のクオンツモデル。UI は藍と朱のピクセル端末。賢人会議（バフェット／ソロス／ヒンメル）が毎年助言する。

## 0. 価値観 → ルール変換表

| 価値観 | ゲームルール |
|---|---|
| 死は終わりではない（異世界前提） | 死亡・破産・自主転生でスキル XP を持ち越して転生。恐怖で選択を縮める理由を消す |
| アラモを忘れるな | 市場暴落年は「アラモの時」イベント。エネルギー +40、売主の投げ売り率が3倍 |
| 成功は誇る、失敗は自慢する | 失敗（却下された買い付け、損失、破産）は自慢ポイントに変換 → 転生時 XP ボーナス |
| 給料は貯めない、投資と学習に回す | 現金比率が高いほど楽しさ・学びが伸びない。貯蓄率は「自分への支払い」として先取り |
| 資産と負債を厳密に区別 | 各物件にキャッシュフロー符号で「資産」「負債」タグ。負債はバフェットが毎年叱る |
| とにかく買い付けを出す。半額でもいい | 売主の本音 θ は混合分布（15% は投げ売り）。半額でも通ることがある。却下でも学び+2、自慢+1 |
| サイクリングで現地を見る | 「偵察」時間で街の推定誤差が縮み、隠し情報（再開発、浸水）が開示される |
| 下心なくギブする | 人脈メーターが銀行 LTV・買い付け通過率・メンター出現率を上げる |
| ロールモデル思考 | 賢人会議。ルールベース + （Artifact 上では）Claude 実応答 |
| 無知に気づいたら自己教育 | クオンツスキルが上がると Kelly、モンテカルロ扇形図、市場生態系が「見える」ようになる |
| 学びと実行はセット | 本を読むだけでは XP 半分。実行（買い付け・投資）で満額 |

## 1. 単位・時間

- 通貨は **万円**（内部は float）。表示は `2,400万` / `1.2億`。
- 1ターン = 1年。開始 22 歳、西暦 2026 年。最大 100 歳。
- 市場・金利は内部で月次 12 ステップ。UI には年次集計 + 月次パス（チャート用）を出す。

## 2. 状態モデル（JSON シリアライズ可能）

```js
GameState = {
  version: 1,
  seed: number,                     // この人生の乱数種
  rngState: number[],               // 乱数器の内部状態（保存/復元用）
  life: { n, age, year, alive, deathCause: null|'natural'|'illness'|'bankrupt'|'voluntary', epitaph: null|string },
  money: { cash, stocks, debt },    // stocks = 時価。debt = 物件ローン残高合計（表示用、正本は props[].loan）
  props: Property[],                // 所有物件
  meters: { fun, energy, network, learning, funTotal },   // fun/energy/network: 0..100, learning/funTotal: 累積
  skills: { reading, comm, local, quant, guts },          // 各 { xp: number }  level は関数で導出
  brag: { failures: string[] , points: number },          // この人生での失敗ログと自慢ポイント
  work: { salary, employed, hustleIncome, passiveIncome },
  market: MarketState,
  city: CityState,
  policy: Decisions,                // 直近の采配（UI 初期値）
  history: YearRecord[],
  log: LogEntry[],                  // 最新が末尾
  flags: { tutorialSeen, alamoCount, offersMade, offersAccepted, fired }
}

Meta = {                            // localStorage 'isekai-quant:meta'
  version: 1,
  lives: number,
  skills: { reading, comm, local, quant, guts },   // 持ち越し XP
  bragPoints: number,
  hallOfFame: HallEntry[],          // 上位 10
  bestScore: number,
  tutorialDone: boolean
}
```

### Decisions（毎年の采配）

```js
Decisions = {
  time: { reading, scouting, networking, fun, hustle },  // 合計 100
  savingsRate: 0..0.8,        // 手取りのうち先取りで投資に回す割合
  stockAlloc: 0..1,           // 流動資産（現金+株）のうち株式の目標比率
  scoutTargets: districtId[], // 偵察先（最大 3）
  offers: [{ listingId, bidRatio, ltv }],   // bidRatio = 提示額 / 売出価格
  sells: propertyId[],
  books: bookId[],            // 今年読む本（最大 2、reading 時間が必要）
  quitJob: boolean            // FIRE（不労所得 > 生活費 のとき可能）
}
```

## 3. 人生モデル（life.js）

- 給与: 22歳 400万。毎年 `salary *= 1 + 0.02 + 0.006*L(reading) + 0.006*L(comm)`（55歳まで、以降 −2%/年、60で定年 → 0）。上限 2,000万。
- 税・社会保険: 手取り = 給与 × (1 − t)、t = 0.15 + 0.15 × clamp((給与−300)/1500, 0, 1)。
- 生活費: 240万 + 楽しむ時間 × 1.2万（fun 時間 50 → +60万）。年齢 40+ で +20%。
- 副業: `hustle時間 × (0.4 + 0.08*L(reading) + 0.08*L(comm)) 万`。時間 30 で L5 なら 36万。
- 先取り投資: savings = 手取り × savingsRate。残りが生活費を下回ると現金から補填。
- 死亡ハザード（Gompertz–Makeham）: `h = 0.0001 * exp(0.1*(age-20))` × 修正 (fun>60: ×0.85, energy<10 & age>50: ×1.2, 破産年: ×1.5)。
  - 22歳 0.00012 / 50歳 0.002 / 70歳 0.015 / 85歳 0.066。85歳生存率 ≈ 51%。
- 病気イベント: 年 2% + 0.05%×(age−40)+ 。医療費 100〜500万、その年の時間 −30。
- 破産: 現金 < 0 かつ 物件強制売却（時価 −20%）後も純資産 < 0 → deathCause 'bankrupt'。

## 4. スキル（skills.js）

5 スキル。`level(xp) = min(10, floor(sqrt(xp / 40)))`。L10 = 4,000 XP。

| skill | 上げ方（XP/年） | 効果 |
|---|---|---|
| reading 読書 | reading時間 × 1.0（本を読むと +40/冊。実行を伴うと×2） | 給与成長、副業、学び倍率 |
| comm コミュ力 | networking時間 × 1.0、買い付け提出 +10 | 買い付け通過 θ −0.008/L、LTV +0.02/L、人脈成長 |
| local 地域知 | scouting時間 × 1.0、偵察で秘密発見 +25 | 推定誤差 −6%/L、秘密発見率 +4%/L |
| quant クオンツ | 損失年 +30、本（クオンツ系）+60、株式保有年 +8 | ダッシュボード解放（§8） |
| guts 胆力 | bidRatio ≤ 0.7 の買い付け +25、暴落年に株を買い増し +40、自主転生 +100 | エネルギー変換率、恐怖ペナルティ除去 |

energy ≥ 50 のとき XP 獲得 ×1.5。

## 5. メーター

- fun (0..100): `fun = fun*0.85 + funTime*0.6 + 大胆な行動 5/回`。funTotal は累積（スコア用）。
- energy (0..100): アラモ +40、失敗 +8/件、`energy *= 0.7` 毎年。
- network (0..100): `network = network*0.92 + networking*0.5 + ギブイベント 10`。
- learning (累積): `+= reading*0.3 + 損失率×30 + 却下買い付け×2 + 本 ×5`。

## 6. 市場モデル（market.js）— 反射的エージェントベース市場

Brock–Hommes 型。参加者は「ファンダメンタリスト」と「チャーティスト」。シェアが成績で入れ替わる → 内生的バブルと暴落。

月次:
```
f_{t+1} = f_t + (μ_f − σ_f²/2)/12 + σ_f/√12 · ε        μ_f=0.05, σ_f=0.10
x_t     = p_t − f_t                                        （対数乖離。x>0 で割高）
E_f     = −φ · x_t · (1 + 2·max(0, |x_t| − 0.3))           φ=0.06 （乖離が大きいほど強く戻す）
E_c     = g · (p_t − p_{t−1})                              g=0.85
p_{t+1} = p_t + (f_{t+1} − f_t)·0.6 + λ(w_f·E_f + w_c·E_c) + σ_n ε_n     λ=1.0, σ_n=0.035
U_f     = 0.8·U_f + 0.2·(−x_{t−1} · Δp_t)                 （ファンダ派の利益）
U_c     = 0.8·U_c + 0.2·(Δp_{t−1} · Δp_t)                 （チャート派の利益）
w_c     = 1 / (1 + exp(−β (U_c − U_f)))                    β=250、clamp 0.05..0.95
配当利回り = 0.02 · exp(−x_t)  （割高なほど低い）
```
年次出力: `{ totalReturn, priceReturn, dividendYield, x (年末乖離), wc (年末チャート派比率), monthly: number[12] (指数の月次終値), vol (年率化), crash: totalReturn < −0.25, bubble: x > 0.35 }`

金利: `r_{t+1} = r_t + 0.25(0.02 − r_t) + 0.01·(wc−0.5) + 0.004·ε`、clamp 0.001..0.08。住宅ローン金利 = r + 0.012。預金金利 = r × 0.3。

**キャリブレーション受入基準**（10,000 年シミュレーション、seed 複数）:
- 年次トータルリターン: 平均 5〜9%、標準偏差 16〜26%、歪度 < 0
- 暴落年（< −25%）の頻度: 5〜12%
- バブル年（x > 0.35）の頻度: 8〜25%
- 20年ローリングの年率リターンが −2% 未満になる確率 < 5%
- 最大乖離 |x| < 1.5（発散しない）

## 7. 街と不動産（city.js）

- 6×6 = 36 地区。各地区: `{ id, name, kind: '駅前'|'住宅'|'郊外'|'湾岸'|'山手'|'工業', value (真の相場, 万), yieldRate, trend (隠し g), secrets: Secret[], visits, knownSecrets: id[], estError (推定誤差 σ) }`
- 初期値: value 1,500〜9,000万、yieldRate 0.035〜0.13（value と逆相関 + ノイズ）、trend −0.03〜+0.04。
- Secret（地区あたり 0〜2）: `{ id, kind, text, effect }`。例: 再開発（trend +0.03）、新駅（年 N に value +25%）、工場閉鎖（trend −0.03）、高齢化（yield −0.01/年）、浸水リスク（年 3% で value −30%）、大学移転（±）。偵察で発見。開示テキストは「配達員の話」「工事のおっちゃん」「不動産屋の愚痴」など現地の人の語り口。
- 推定: `estimate = value · exp(estError · ε)`、`estError = 0.30 · exp(−0.35·visits) · (1 − 0.06·L(local))`。偵察 1 回 = scouting 時間 10。
- 売出し: 毎年各地区 0〜2 件。`ask = value · (1 + m)`, `m ~ N(0.08, 0.08)`。売主本音 `θ`: 85% `N(0.92, 0.04)` / 15% `N(0.68, 0.08)`（投げ売り）。暴落年は投げ売り 45%。
- 買い付け通過: `p = σ(30·(bidRatio − θ_eff))`, `θ_eff = θ − 0.008·L(comm) − 0.03·(network>60) − 0.02·(energy>50)`。
- 却下時の反応（学びになる）: bid > θ−0.05 → 「惜しい。あと一歩だった」、bid > θ−0.15 → 「検討はしてくれた」、それ以下 → 「鼻で笑われた」。
- 融資: LTV 上限 `0.70 + 0.02·L(comm) + 0.10·(network>60)`、ただし年収倍率 ≤ 8 × (給与+副業+家賃)。金利は住宅ローン金利（変動、毎年更新）。25 年元利均等。諸費用 7%。
- 年次 CF = `rent·(1−0.08) − 0.01·value − 利息 − 元本`（rent = yieldRate × value）。CF ≥ 0 → 資産、< 0 → 負債。
- 価値推移: `log value += trend + 0.3·(marketReturn − 0.05) + 0.06·ε + secret shocks`。家賃は value の成長の半分で追随。
- 売却: 手取り = `value · 0.95 − loan残`（暴落年は value −20%）。

## 8. クオンツ（quant.js）

- `kelly(returns[], r)`: μ̂, σ̂（履歴 < 5 年なら事前分布 μ=0.06, σ=0.20 と混合） → `f* = (μ̂ − r)/σ̂²`、half-Kelly も返す。
- `monteCarlo(state, decisions, {n: 400, years: 100−age})`: 市場モデルを新規 RNG で回し、現在の采配を固定した純資産分布 → 各年の quantiles {p5, p25, p50, p75, p95} と破産確率。物件は trend+vol の近似で。
- `stats(history)`: CAGR、年率 vol、Sharpe、最大ドローダウン、最悪年。
- 解放レベル（quant スキル）: L0 純資産グラフ / L1 統計 + ドローダウン / L2 Kelly / L3 モンテカルロ扇形図 / L4 市場生態系（wc, x の時系列）。

## 9. イベント（events.js）

年次で判定。ログに残り、一部はモーダルで演出。

| イベント | 条件 | 効果 |
|---|---|---|
| アラモの時 | market.crash | energy +40、投げ売り率↑、全画面「REMEMBER THE ALAMO」 |
| 出会い（達成者） | network ≥ 60 で年 25% | 好きなスキル +80 XP、「秘訣」テキスト |
| 配達員の話 | scouting ≥ 20 | 偵察先の秘密開示率 +20% |
| 病気 | §3 | 医療費、時間 −30 |
| 転職オファー | comm ≥ L3、年 10% | 給与 +15% |
| リストラ | 45 歳以上、年 3% | employed=false、1年無収入、再就職は給与 −20% |
| 浸水 / 新駅 | secret 発火 | 物件価値変動 |
| 本との出会い | reading ≥ 20 | 読める本が増える |
| ギブ | networking ≥ 30 | 現金 −(手取りの 2%)、network +10、翌年以降 25% で「返礼」（+3 倍） |

## 10. 本（books.js）

各本: `{ id, title, author, cost 時間 10, effects, quote }`。読むと XP と一時効果。実行を伴う（同年に買い付け or 株買い増し）と効果 ×2。
例: 『バフェットからの手紙』(quant+reading)、『ソロスの錬金術』(quant, wc 表示を 1 年解放)、『金持ち父さん』(local, CF タグの解説)、『葬送のフリーレン』(guts, fun)、『影響力の武器』(comm)、『確率論的思考』(quant)。

## 11. 賢人会議（council.js）

3 人。毎年、状態から 1 人 1 発言（60〜120 字、日本語）。`{ id, name, text, stance: 'bull'|'bear'|'neutral'|'life', focus: string }`。

- **バフェット**: 本源価値。x > 0.35 → 恐れよ。x < −0.25 → 貪欲に。負債物件 → 叱る。LTV > 0.8 → レバレッジ警告。平時 → 読書と忍耐。
- **ソロス**: 反射性。wc 上昇 + トレンド → 乗れ、ただし撤退線を。wc > 0.7 & x > 0.3 → 転換点近い、減らせ。暴落 → 急所を狙え。平時 → 仮説を言語化しろ。
- **ヒンメル**: 人生。fun < 30 → 楽しめ。network < 30 → 与えよ。energy ≥ 50 → 最悪の時が最高の時。富はあるが fun 低 → 銅像より笑顔。
- Artifact 上では `claude.use('sample')` が使えるとき「深く聞く」ボタンで Claude が同じペルソナで状態 JSON を読んで応答。なければ非表示。

## 12. スコア（score.js）

```
富  W = 1000 · (1 − exp(−NW/30000))          NW 万円。3 億で 632、10 億で 964
楽  F = 1000 · (1 − exp(−funTotal/2500))
学  L = 1000 · (1 − exp(−learning/1500))
縁  N = 1000 · (1 − exp(−networkTotal/2500))
自慢 B = 20 · brag.points
総合 = W + F + L + N + B
```
死亡時の遺言（epitaph）は最大要素から生成。例: 富 → 「金は残した。次は笑え。」

## 13. 転生

死亡 / 破産 / 自主転生 →「転生画面」:
1. 人生の要約（享年、純資産推移スパークライン、スコア内訳、イベント数）
2. 「失敗を自慢する」ボタン: 失敗リストを 1 件ずつ表示 → 自慢ポイント（1/件、破産は 5）
3. スキル XP 持ち越し（この人生の獲得分 + 自慢ポイント × 30 XP を好きなスキルに）
4. 殿堂入り判定
5. 「転生する ▶」→ 新 seed、22 歳、スキル継承

## 14. UI

**単一テーマ（意図的）**: 藍のゲーム端末。
- 色: 藍 ground `#0E1A2B` / 面 `#15263D` / 面2 `#1C3251` / 生成り text `#F1E9D2` / 朱 accent `#E4482C` / 金 `#D9A441` / 青磁 positive `#6FBFA3` / 藤 muted `#8F8CB8` / 罫 `#2A4266`
- 型: 見出し・UI = `DotGothic16`（ピクセル）/ 賢人の声・遺言 = `Shippori Mincho B1` / 数値 = `IBM Plex Mono`（tabular-nums）。Google Fonts、フォールバック指定。
- レイアウト: ヘッダ（タイトル、第N生、年齢/西暦、純資産、スコア）。3 カラム（左: 今年の采配 / 中: 資産・市場・街・クオンツ / 右: 賢人会議・ログ）。下部固定「今年を終える ▶」。1000px 未満で 1 カラム。
- モーダル: 街と買い付け / 本棚 / 転生 / 殿堂 / 遊び方。
- チャート: Canvas 2D 手描き（ライブラリなし）。資産は積み上げ面（現金・株・不動産純資産、負債は下向き）。市場は指数と本源価値（quant L1 以上で本源表示）。扇形図は分位バンド。
- 街: 6×6 Canvas。未偵察はフォグ、推定利回りで色、所有はマーク、売出しあり地区に点滅点。
- キーボード: Enter で年送り、Esc でモーダル閉。
- `prefers-reduced-motion` 尊重。アラモ演出は 1.2 秒。

## 15. ビルド・テスト

- `src/` は ESM。`npm run build` → esbuild で IIFE バンドル → `dist/index.html` 単一ファイル（CSS/JS インライン）。
- `npm test` → `node --test test/`。市場キャリブレーション、買い付け確率、破産、シリアライズ往復、スコア単調性。
- `npm run sim` → `sim/` のヘッドレス方針（放置 / 堅実 / 金持ち父さん / ギャンブラー）で 200 人生を回し、純資産・スコア分布を表にする（バランス確認）。
- `npm run shot` → Playwright で dist を開き、5 年進めてスクリーンショット。
