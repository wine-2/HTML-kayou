# スロットハイエナ支援システム「ハイエナの相棒」企画書

> 最終更新: 2026-05-08
> 作成者: しょーま
> ステータス: 設計確定・実装前

---

## 1. プロダクト概要

### コンセプト

パチスロの「ハイエナ（天井狙い・ゾーン狙い）」を支援するDiscord Botシステム。
スラッシュコマンドや写真送信で、期待値・狙い目・やめどきを即座に返答する。

「スラッシュコマンド一発で期待値が出る。写真送ってもOK。ハイエナ中に片手で使える相棒。」

### ターゲットユーザー

- パチスロの天井狙い・ゾーン狙いで期待値稼働している人
- 副業スロッター（夕方〜夜の短時間稼働）
- 情報収集が面倒だが勝ちたい人

### 既存ツールとの差別化

| 既存ツール | ハイエナの相棒 |
|-----------|--------------|
| フォームに入力 → 表から検索 | スラッシュコマンド or 写真で即判定 |
| ゲーム数のみで判断 | G数+スルー+差枚+有利区間+モード示唆を総合判断 |
| 人力更新（遅い・漏れる） | データ更新ワークフロー + AI写真解析で新台も対応 |
| 自分で探す | お宝台を自動検知して通知 |
| 個人で完結 | Discordコミュニティで情報共有もできる |

---

## 2. 設計思想：判断基準の分離

このシステムの最重要原則。**確定情報とAI分析を絶対に混ぜない。**

### 確定情報（confidence: "confirmed"）

- 天井ゲーム数
- ゲーム数別の期待値
- 狙い目ライン
- やめどき
- ゾーン情報

**信頼できる外部ソースから取得し、人間が検証してDBに登録したもの。**
AIが独自に計算・推測するものではない。

### AI分析（confidence: "estimated"）

- ホールごとの設定配分傾向
- 曜日・イベント日の傾向
- 特定機種の設定推測

**実データをClaude APIで分析して生成する参考情報。**
ユーザーには「AI分析による参考情報」であることを必ず明示する。

### 表示ルール

ユーザーへの返答では、確定情報とAI分析を視覚的に分離する:

```
━━━━━━━━━━━━━━━━━━━
📊 北斗の拳  現在650G

【期待値】+4,500円（天井まで残り150G）
【やめどき】AT後即やめ
━━━━━━━━━━━━━━━━━━━
💡 参考（AI分析）
  このホールの北斗は火曜に
  高設定傾向あり。
  ※ 過去データからの推測です
━━━━━━━━━━━━━━━━━━━
```

確定情報には出典ラベルなし（事実として提示）。
AI分析には必ず「参考」「推測」の文言を付与。

---

## 3. 機能一覧

### 機能①: スラッシュコマンドで期待値照会（MVP・最優先）

```
ユーザー: /ev 北斗 650

Bot:
┌─────────────────────────────┐
│ 🔥 打て！                    │
│                               │
│ 📊 スマスロ北斗の拳           │
│ 現在: 650G                    │
│ 期待値: +4,500円              │
│ 天井: 800G（残り150G ≒ 約10分）│
│                               │
│ やめどき: AT後即やめ           │
│ ゾーン: 200G台・500G台CZ      │
└─────────────────────────────┘
```

**スラッシュコマンド一覧:**

| コマンド | 説明 | 例 |
|---------|------|-----|
| `/ev {機種名} {G数}` | 期待値照会 | `/ev 北斗 650` |
| `/ev {機種名} {G数} {スルー数}` | スルー込み照会 | `/ev バジ 400 3スルー` |
| `/info {機種名}` | 機種情報一覧 | `/info 北斗` |
| `/hall {ホール名}` | ホール傾向 | `/hall マルハン新世界` |
| `/notify on` | お宝台通知ON | `/notify on` |
| `/notify off` | お宝台通知OFF | `/notify off` |
| `/myhall add {ホール名}` | ホール登録 | `/myhall add マルハン新世界` |
| `/myhall list` | 登録ホール一覧 | `/myhall list` |
| `/help` | 使い方 | `/help` |

### 機能②: 写真判定（Claude Vision）

ユーザーがデータカウンターの写真をチャンネルに投稿すると、自動で解析。

**処理フロー:**

1. 画像添付を検知
2. Claude Vision APIに送信
3. 機種名・G数・BIG/REG回数・差枚数を抽出
4. 確定情報DBと照合して期待値を返答
5. 読み取れない場合は「この情報で合ってますか？」とユーザーに確認

**Claude Vision へのプロンプト:**

```
あなたはパチスロのデータカウンター画像の読み取り専門AIです。
画像から以下を読み取ってください:

1. 機種名（推定）
2. 現在のゲーム数
3. BIG回数
4. REG回数
5. 差枚数（表示されていれば）
6. スルー回数（推定可能なら）
7. その他の示唆情報

JSON形式で出力:
{
  "machine_name": "str or null",
  "current_game": number or null,
  "big_count": number or null,
  "reg_count": number or null,
  "diff_medals": number or null,
  "skip_count": number or null,
  "raw_reads": "読み取った内容の要約",
  "confidence": "high / medium / low"
}

読み取れない項目はnullにする。推測で値を埋めない。
```

### 機能③: お宝台プッシュ通知（サイトセブン連携）

**※ Phase 0の規約チェック完了後に着手。使えない場合の代替案あり（後述）。**

```
[Discord DM 自動通知]
┌─────────────────────────────┐
│ 🔥 お宝台を検知！             │
│                               │
│ 🏪 マルハン新世界             │
│ 📊 北斗の拳 #35番台           │
│ 現在: 847G（天井まで残り53G）  │
│ 期待値: +8,200円              │
│                               │
│ ※ 10分前のデータです           │
└─────────────────────────────┘
```

**処理フロー（定期実行）:**

1. ユーザーの登録ホールを取得
2. データソースから各ホールの台データを取得
3. 各台のG数と `machines.target_line` を比較
4. 狙い目ラインを超え、かつユーザーの `notify_threshold` 以上の台を検知
5. 重複チェック（同一台への再通知抑止）
6. 静音時間チェック
7. Discord DMで通知

### 機能④: ホール傾向分析（AI分析）

```
ユーザー: /hall マルハン新世界

Bot:
┌─────────────────────────────┐
│ 💡 マルハン新世界 AI分析       │
│ ※ 過去30日のデータに基づく     │
│   参考情報です                 │
│                               │
│ ・火曜と金曜に高設定傾向       │
│ ・北斗は角台に設定が入りやすい  │
│ ・先週は回収日が多め           │
│                               │
│ 分析日: 2026-05-08            │
└─────────────────────────────┘
```

---

## 4. データベース設計（Supabase / PostgreSQL）

### 4.1 machines テーブル（確定情報）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| name | text | ○ | 正式機種名（例: "スマスロ北斗の拳"） |
| ceiling_game | integer | ○ | 天井ゲーム数 |
| ceiling_bonus | text | ○ | 天井到達時の恩恵 |
| target_line | integer | ○ | 狙い目ライン（このG数から打つ） |
| expected_values | jsonb | ○ | ゲーム数別の期待値テーブル |
| quit_point | text | ○ | やめどき |
| zone_info | text | - | ゾーン情報 |
| skip_bonus | jsonb | - | スルー回数による期待値補正 |
| pure_increase | numeric | - | 純増枚数 |
| memo | text | - | 補足情報 |
| confidence | text | ○ | "confirmed" 固定 |
| source_url | text | - | 参照元URL |
| source_date | date | - | 参照元情報の公開日 |
| version | integer | ○ | データ版数（更新ごとに+1） |
| reviewed_by | text | ○ | 最終確認者 |
| effective_from | date | ○ | 適用開始日 |
| effective_to | date | - | 適用終了日（撤去・仕様変更時） |
| is_active | boolean | ○ | 現行版フラグ |
| source_meta | jsonb | - | 備考・参照元メタ情報 |
| created_at | timestamptz | ○ | 作成日 |
| updated_at | timestamptz | ○ | 更新日 |

#### expected_values の構造

データソースに掲載されているG数刻みをそのまま保持する。
中間G数の期待値は線形補間で算出する（補間はあくまでフォールバック）。

```json
{
  "values": [
    {"game": 0, "ev": -2500},
    {"game": 100, "ev": -1800},
    {"game": 200, "ev": -1000},
    {"game": 300, "ev": 200},
    {"game": 400, "ev": 1200},
    {"game": 500, "ev": 2800},
    {"game": 600, "ev": 4500},
    {"game": 700, "ev": 7200},
    {"game": 800, "ev": 12000}
  ],
  "interpolation": "linear",
  "unit": "yen",
  "exchange_rate": "等価"
}
```

#### skip_bonus の構造

```json
{
  "enabled": true,
  "thresholds": [
    {"from_skip": 3, "ev_bonus": 2000, "note": "3スルーから期待値+2000円"},
    {"from_skip": 5, "ev_bonus": 5000, "note": "5スルーは激アツ"}
  ]
}
```

### 4.2 machine_aliases テーブル（機種名の揺れ吸収）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| machine_id | uuid | ○ | machines.id への外部キー |
| alias | text | ○ | 別名（例: "北斗", "ほくと", "hokuto"） |
| normalized_alias | text | ○ | 正規化済み（ひらがな・小文字化） |
| priority | integer | ○ | 解決優先度（数字が小さいほど優先） |

機種名解決の処理:
1. ユーザー入力をひらがな・小文字に正規化
2. `normalized_alias` で完全一致検索
3. 一致なし → 部分一致検索
4. 複数候補 → priority順でソート、上位1件を返す
5. 候補なし → Claude APIで推測 → 「{機種名}で合ってますか？」とユーザーに確認
6. それでも不明 → 「機種が見つかりません。正式名称で入力してください」

### 4.3 halls テーブル（ホール情報）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| name | text | ○ | ホール名 |
| area | text | - | エリア（例: "大阪市浪速区"） |
| external_id | text | - | 外部データソースでのID |
| data_source | text | - | データソース名 |
| is_active | boolean | ○ | 有効フラグ |
| created_at | timestamptz | ○ | 登録日 |

### 4.4 hall_analysis テーブル（AI分析結果）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| hall_id | uuid | ○ | halls.id への外部キー |
| machine_name | text | - | 対象機種名（全体分析ならnull） |
| analysis_text | text | ○ | 分析結果テキスト |
| data_period | text | ○ | 分析対象期間（例: "過去30日"） |
| confidence | text | ○ | "estimated" 固定 |
| model_name | text | ○ | 利用モデル名（例: "claude-sonnet-4-20250514"） |
| prompt_version | text | ○ | プロンプト版数 |
| input_snapshot_id | text | - | 入力データスナップショット識別子 |
| generated_at | timestamptz | ○ | 分析生成日 |

### 4.5 users テーブル（Discordユーザー）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| discord_user_id | text | ○ | Discord ユーザーID（一意） |
| display_name | text | - | 表示名 |
| plan | text | ○ | "free" / "basic" / "pro" |
| daily_usage_count | integer | ○ | 当日利用回数（毎日0にリセット） |
| daily_usage_date | date | ○ | 利用回数のカウント日 |
| favorite_halls | uuid[] | - | お気に入りホールのID配列（最大5件） |
| notify_enabled | boolean | ○ | プッシュ通知ON/OFF |
| notify_threshold | integer | ○ | 通知する期待値の下限（円） |
| quiet_hours | jsonb | - | 静音時間 例: {"start":"23:00","end":"08:00"} |
| created_at | timestamptz | ○ | 登録日 |

### 4.6 notification_history テーブル（通知重複管理）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| user_id | uuid | ○ | users.id |
| hall_id | uuid | ○ | halls.id |
| machine_id | uuid | ○ | machines.id |
| machine_number | text | ○ | 台番号 |
| game_count | integer | ○ | 通知時ゲーム数 |
| ev_value | integer | ○ | 通知時期待値（円） |
| dedupe_key | text | ○ | 重複判定キー（hall+台番号+G数帯） |
| expires_at | timestamptz | ○ | 再通知許可時刻 |
| sent_at | timestamptz | ○ | 送信時刻 |

重複判定ルール:
- `dedupe_key` = `{hall_id}_{machine_number}_{floor(game_count/100)*100}`
- 同一キーの通知は `expires_at` まで再送しない
- `expires_at` = 送信時刻 + 60分（デフォルト）

### 4.7 request_log テーブル（KPI計測用）

| カラム名 | 型 | 必須 | 説明 |
|---------|-----|------|------|
| id | uuid | ○ | 主キー |
| user_id | uuid | ○ | users.id |
| request_type | text | ○ | "text_ev" / "image_ev" / "hall_trend" / "info" |
| input_raw | text | ○ | ユーザーの生入力 |
| parsed_machine | text | - | 解析された機種名 |
| parsed_game | integer | - | 解析されたG数 |
| parse_success | boolean | ○ | 解析成功したか |
| response_time_ms | integer | ○ | レスポンス時間（ミリ秒） |
| user_corrected | boolean | ○ | ユーザーが修正したか（誤判定検知） |
| claude_cost_usd | numeric | - | Claude API費用（USD） |
| created_at | timestamptz | ○ | リクエスト日時 |

---

## 5. 技術スタック

| 要素 | 技術 | 費用 |
|------|------|------|
| Bot基盤 | discord.js v14 + Node.js | 無料 |
| ホスティング | Vercel（API Routes）or Railway | 無料枠〜月2,000円 |
| データベース | Supabase（PostgreSQL） | 無料枠（500MB） |
| AI（テキスト解析） | Claude API（テキスト） | 従量課金 |
| AI（画像解析） | Claude API（Vision） | 従量課金 |
| 定期実行 | Vercel Cron or Railway Cron | 無料枠 |
| 決済（将来） | Stripe Checkout | 手数料3.6% |

### Discord Bot 固有の設計

**Bot の権限（Intents）:**
- `GUILDS` — サーバー情報の取得
- `GUILD_MESSAGES` — メッセージ受信
- `DIRECT_MESSAGES` — DM送受信（通知用）
- `MESSAGE_CONTENT` — メッセージ内容の読み取り（写真検知用）

**Embed メッセージ:**
Discord の Embed を使ってリッチな表示を行う。色分けで判定結果を視覚化:
- 緑 (#00e676) → 🔥 打て！
- 赤 (#ff3030) → ✋ まだ早い
- 黄 (#ffab00) → ⚠️ 微妙

**ロールによるプラン管理（将来）:**
- `@無料会員` — 1日5回まで、テキストのみ
- `@ベーシック` — 無制限、テキスト+写真
- `@プロ` — 全機能（写真+お宝台通知+ホール分析）

Stripe決済完了 → Webhook → Botがロールを自動付与

### コスト見積もり

#### Claude API 実コスト（1リクエストあたり）

| 処理 | input tokens | output tokens | 推定コスト |
|------|-------------|--------------|-----------|
| テキスト解析 | ~500 | ~200 | 約0.5〜1円 |
| 画像解析 | ~1500（画像含む） | ~500 | 約5〜15円 |
| ホール分析 | ~3000 | ~1000 | 約15〜30円 |

※ 画像サイズにより大幅に変動。大きい画像はリサイズしてから送信する（最大1024px）。

#### 月額コスト見込み

| 項目 | 100ユーザー | 500ユーザー |
|------|-----------|-----------|
| Supabase | 0円 | 0円（無料枠内） |
| ホスティング | 0円 | 2,000円 |
| Claude API（テキスト） | 1,500円 | 7,500円 |
| Claude API（画像） | 3,000円 | 15,000円 |
| **合計** | **約4,500円** | **約24,500円** |

#### コスト制御策

- 無料プランは画像解析を含めない（テキストのみ）
- 無料プランは1日5回まで（`daily_usage_count` で制御）
- 画像は1024px以下にリサイズしてからAPI送信
- テキスト解析は正規表現ベースを優先、Claude APIはフォールバックのみ
- 月間API費用が上限（設定値）を超えたらアラート通知

---

## 6. メッセージ解析ロジック

### テキスト解析（正規表現ベース・Claude API不要）

```
入力: "/ev 北斗 650"

Step 1: コマンド解析
  → intent: "check_ev", args: ["北斗", "650"]

Step 2: 機種名解決
  → "北斗" を normalized_alias で検索
  → machine_aliases から "北斗" → machines.id を解決

Step 3: G数抽出
  → 正規表現: /(\d+)\s*(g|ゲーム|回転)?/i
  → 650

Step 4: オプション抽出
  → スルー: /(\d+)\s*スルー/
  → 時間: /(\d+)\s*(時間|h)/i
  → 優遇/冷遇: /優遇|冷遇/

Step 5: DB照会 → 期待値算出 → 返答生成
```

### Claude API フォールバック（正規表現で解析失敗時のみ）

```
以下のメッセージからパチスロの機種名とゲーム数を抽出してください。
JSON形式で返してください。

メッセージ: "{ユーザーの入力}"

出力形式:
{
  "machine_name": "機種名 or null",
  "game_count": number or null,
  "skip_count": number or null,
  "extra_info": "その他読み取れた情報 or null"
}

読み取れない項目はnullにする。推測で値を埋めない。
```

### 機種名解決のフォールバックチェーン

```
1. normalized_alias 完全一致 → 解決
2. normalized_alias 部分一致 → 候補が1つなら解決
3. 部分一致で複数候補 → 「どの機種ですか？」と候補提示
4. 候補なし → Claude APIで推測
5. Claude推測結果 → 「{機種名}で合ってますか？」とユーザー確認
6. それでも不明 → 「機種が見つかりません」
```

---

## 7. エラーハンドリング

| エラー種別 | 原因 | ユーザーへの返答 | 内部処理 |
|-----------|------|----------------|---------|
| 機種名不明 | aliasに未登録 | 「機種が特定できません。正式名称を入力してください」 | request_logに記録 |
| G数なし | 数値が入力にない | 「G数を教えてください。例: /ev 北斗 650」 | - |
| 画像解析失敗 | 不鮮明・非対応画像 | 「読み取れませんでした。データカウンターが鮮明に写った写真を送ってください」 | request_logに記録 |
| Claude API障害 | API停止・レート制限 | 「一時的にAI解析が利用できません。テキストコマンドをお試しください」 | エラーログ + 管理者通知 |
| DB接続エラー | Supabase障害 | 「システムエラーが発生しました。しばらくしてからお試しください」 | エラーログ + 管理者通知 |
| 利用上限到達 | 無料プランの日次上限 | 「本日の無料枠（5回）を使い切りました。明日リセットされます」 | - |
| 未対応機種 | DBに機種データなし | 「{機種名}のデータはまだ登録されていません」 | 要望として記録 |

---

## 8. サイトセブン連携の代替戦略

### Phase 0 の判断基準

サイトセブン連携が利用規約上使えるかどうかで、Phase 2以降の進め方が変わる。

```
Phase 0 結果 → 分岐
│
├── 使える → Plan A: サイトセブン連携でお宝台通知を実装
│
├── グレー → Plan B: 手動データ入力+コミュニティ報告型
│              ユーザーが「/report マルハン新世界 北斗 #35 850G」で
│              台情報を報告 → 他のユーザーにシェア
│              → コミュニティの力で情報収集
│
└── 使えない → Plan C: お宝台通知は断念、期待値照会+写真判定に集中
                通知機能は将来、ホール公式API等が出た時に再検討
```

**重要: Plan Cでもサービスとして成立するか？**

→ 成立する。理由:
- 期待値照会だけでも「片手でスラッシュコマンド一発」の利便性がある
- 写真判定は既存ツールにない独自機能
- Discordコミュニティによる情報共有が付加価値になる
- お宝台通知はあくまで追加機能であり、コア価値ではない

### Plan B（コミュニティ報告型）の詳細

```
ユーザーA: /report マルハン新世界 北斗 #35 850G

Bot:
「📝 登録しました！
  マルハン新世界 北斗の拳 #35: 850G
  期待値: +8,200円
  ※ この情報は他のユーザーにも共有されます」

→ 他のユーザーが /scan マルハン新世界 と打つと
  報告された台の一覧が表示される

→ 30分以上前のデータは自動で期限切れ表示
```

---

## 9. 確定情報DBの更新ワークフロー

### 初期データ投入

```
Step 1: Claude CWORKで外部ソースの情報を整理
  → 機種名、天井、期待値テーブル、やめどき等をJSON形式に変換
  → AIは「まとめる」だけ。値の計算や推測はしない

Step 2: 人間（しょーま）が内容を目視確認
  → 数値の正確性、やめどきの妥当性をチェック

Step 3: Supabaseに登録
  → reviewed_by: "shouma"
  → version: 1
  → effective_from: 登録日
  → is_active: true
```

### 定期更新（新台追加・既存機種の情報変更）

```
Step 1: 新台リリース or 解析情報更新を検知（人間が判断）
Step 2: Claude CWORKで最新情報を整理
Step 3: 人間が確認
Step 4: Supabaseで既存レコードの is_active を false に変更
Step 5: 新レコードを version +1 で追加
  → 変更履歴が残る
```

### alias の追加

```
ユーザーから「○○で検索したけど出なかった」という報告
→ request_log で parse_success=false のパターンを分析
→ 必要な alias を machine_aliases に追加
→ 以後は解決できるようになる
```

---

## 10. 収益モデル

### 料金プラン

| プラン | 月額 | 内容 |
|-------|------|------|
| 無料 | 0円 | 1日5回・テキスト照会のみ |
| ベーシック | 500円 | 無制限・テキスト+写真 |
| プロ | 980円 | 全機能（写真+お宝台通知+ホール分析） |

### 決済フロー（Stripe Checkout）

```
1. ユーザーが /subscribe と入力
2. BotがStripe Checkoutへの外部リンクを返す
3. ユーザーがブラウザでカード情報を入力・決済
4. Stripe Webhook → Botが受信
5. Botがユーザーのplanを更新 + Discordロールを付与
6. 解約時: Stripe解約 → Webhook → ロール剥奪 + plan変更
```

### 収益シミュレーション

| ユーザー数 | 課金率 | 月間売上 | API費用 | 粗利 |
|-----------|-------|---------|--------|------|
| 100人 | 20% | 15,600円 | 4,500円 | 11,100円 |
| 500人 | 25% | 97,500円 | 24,500円 | 73,000円 |
| 1,000人 | 30% | 234,000円 | 50,000円 | 184,000円 |

---

## 11. 開発フェーズ

### Phase 0: 事前準備（実装前に完了必須）

- [ ] Discord Developer Portalでアプリ作成・Bot Token取得
- [ ] Discord ToSでBot商用利用・ギャンブル関連コンテンツの可否を確認
- [ ] サイトセブン連携方法が利用規約上問題ないか確認 → Plan A/B/C の決定
- [ ] Supabaseプロジェクト作成・テーブル作成
- [ ] 確定情報DBの初期データ投入（主要機種）
- [ ] machine_aliases の初期データ投入

### Phase 1A: テキスト照会MVP

- [ ] Discord Bot基本構築（discord.js v14）
- [ ] スラッシュコマンド登録（/ev, /info, /help）
- [ ] テキスト解析（正規表現ベース）
- [ ] 機種名解決（machine_aliases 検索）
- [ ] 期待値照会（Supabase → 線形補間 → Embed返答）
- [ ] 利用回数制限（無料プラン: 1日5回）
- [ ] request_log への記録
- [ ] Vercel or Railway にデプロイ
- [ ] テスト: 全登録機種 × 複数G数パターン

### Phase 1B: 写真判定 + あいまい検索

- [ ] 画像添付の検知・取得
- [ ] Claude Vision API 連携
- [ ] 画像解析結果 → 確定情報DB照合 → 返答
- [ ] 画像解析失敗時のフォールバック
- [ ] Claude APIフォールバック（テキスト解析失敗時）
- [ ] 機種名の未解決パターンを request_log から分析 → alias追加
- [ ] テスト: 実際のデータカウンター写真で精度検証

### Phase 2: 通知機能

- [ ] Plan A/B/Cのいずれかを実装
- [ ] /myhall add, /myhall list コマンド
- [ ] /notify on/off コマンド
- [ ] 通知用の定期実行ジョブ
- [ ] notification_history による重複排除
- [ ] quiet_hours による静音時間
- [ ] Discord DMでの通知送信
- [ ] テスト: 通知の到達率・重複排除の動作確認

### Phase 3: AI分析 + 収益化

- [ ] ホールデータの蓄積
- [ ] Claude APIによる傾向分析
- [ ] hall_analysis テーブルへの保存
- [ ] /hall コマンド
- [ ] Stripe Checkout 連携
- [ ] Discordロールによるプラン管理
- [ ] ベーシック/プロプランの機能制限分岐
- [ ] テスト: 決済フロー E2E

---

## 12. ディレクトリ構成

```
slot-hyena-bot/
├── src/
│   ├── index.js              # Botエントリポイント
│   ├── commands/
│   │   ├── ev.js             # /ev コマンド
│   │   ├── info.js           # /info コマンド
│   │   ├── hall.js           # /hall コマンド
│   │   ├── myhall.js         # /myhall コマンド
│   │   ├── notify.js         # /notify コマンド
│   │   ├── report.js         # /report コマンド（Plan B用）
│   │   ├── subscribe.js      # /subscribe コマンド
│   │   └── help.js           # /help コマンド
│   ├── handlers/
│   │   └── image-handler.js  # 画像添付の検知・処理
│   ├── services/
│   │   ├── machine-resolver.js   # 機種名解決
│   │   ├── ev-calculator.js      # 期待値算出（DB照会+線形補間）
│   │   ├── image-analyzer.js     # Claude Vision画像解析
│   │   ├── text-parser.js        # テキスト解析（正規表現）
│   │   ├── claude-fallback.js    # Claude APIフォールバック
│   │   ├── hall-scanner.js       # ホールデータ取得（Plan A用）
│   │   ├── hall-analyzer.js      # ホール傾向分析（Claude）
│   │   ├── notifier.js           # プッシュ通知送信
│   │   └── usage-limiter.js      # 利用回数制限
│   ├── db/
│   │   ├── supabase.js       # Supabase クライアント初期化
│   │   ├── machines.js        # machines テーブル操作
│   │   ├── aliases.js         # machine_aliases テーブル操作
│   │   ├── users.js           # users テーブル操作
│   │   ├── halls.js           # halls テーブル操作
│   │   ├── notifications.js   # notification_history 操作
│   │   └── logs.js            # request_log 操作
│   ├── utils/
│   │   ├── embed-builder.js   # Discord Embed 生成
│   │   ├── interpolate.js     # 期待値の線形補間
│   │   └── normalize.js       # テキスト正規化
│   └── cron/
│       ├── check-halls.js     # お宝台チェック定期実行
│       └── daily-reset.js     # 日次利用回数リセット
├── tests/
│   ├── machine-resolver.test.js
│   ├── ev-calculator.test.js
│   ├── text-parser.test.js
│   └── interpolate.test.js
├── package.json
├── .env
├── .gitignore
└── vercel.json (or railway.toml)
```

### 環境変数（.env）

```
# Discord
DISCORD_BOT_TOKEN=xxx
DISCORD_CLIENT_ID=xxx
DISCORD_GUILD_ID=xxx

# Supabase
SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx

# Anthropic
ANTHROPIC_API_KEY=xxx

# Stripe（Phase 3）
STRIPE_SECRET_KEY=xxx
STRIPE_WEBHOOK_SECRET=xxx

# コスト制御
MAX_MONTHLY_API_COST_USD=50
FREE_DAILY_LIMIT=5

# 通知
NOTIFY_INTERVAL_MINUTES=10
NOTIFY_DEDUPE_MINUTES=60
```

---

## 13. KPI（初期運用の測定指標）

### 計測対象

| KPI | 計測方法 | 目標値（MVP） |
|-----|---------|-------------|
| メッセージ解析成功率 | request_log の parse_success 率 | 90%以上 |
| 平均レスポンス時間 | request_log の response_time_ms 平均 | 2秒以内 |
| 機種誤判定率 | request_log の user_corrected 率 | 5%以下 |
| 日次アクティブユーザー | request_log の distinct user_id/日 | - |
| 通知開封率 | Discord DMの既読率（取得可能な範囲で） | - |
| 課金転換率 | 有料プランユーザー / 全ユーザー | 20%以上 |
| 月間チャーン率 | 解約数 / 有料ユーザー数 | 10%以下 |

### 改善サイクル

```
毎週:
  request_log から parse_success=false のパターンを分析
  → 不足している alias を追加
  → 不足している機種データを追加

毎月:
  収益 vs コスト の確認
  → API費用が想定を超えていないか
  → 課金転換率の推移
```

---

## 14. セキュリティ

- Discord Bot Token、API Key、DB接続情報は全て環境変数で管理（.envはgitに含めない）
- Supabase の Row Level Security (RLS) を有効化し、直接アクセスを防止
- ユーザーのDiscord IDは保持するが、それ以外の個人情報は収集しない
- Stripe決済情報はStripe側で管理、自サーバーにはカード情報を保持しない
- 画像データはClaude APIに送信後、自サーバーには保持しない（一時処理のみ）

---

## 15. 注意事項

- 期待値などの確定情報はAIが計算するものではない。信頼できる外部ソースから取得し、人間が検証してDBに登録したものを参照する
- AI分析結果は必ず「参考情報」であることをユーザーに明示する
- 特定のサイト名やソース名をコード内・ユーザー向け表示にハードコードしない
- ユーザーの個人情報は最小限の保持にとどめる
- Discord ToSに抵触する機能は実装しない
- Phase 0の法務チェックが未完了の場合、Phase 2以降には着手しない
