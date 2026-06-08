# スロットハイエナ支援システム 企画書

## 概要

パチスロの「ハイエナ（天井狙い・ゾーン狙い）」を支援するLINE Botシステム。
ユーザーがLINEで機種名とゲーム数を送ると、期待値や狙い目の情報を即座に返答する。

---

## システム全体像

```
ユーザー（LINE）
    │
    ▼
LINE Messaging API
    │
    ▼
バックエンドサーバー（Vercel / Node.js）
    │
    ├──→ 確定情報DB（Supabase）
    │      機種の天井・期待値・狙い目など
    │      人間が信頼できるソースから登録した情報
    │
    ├──→ AI分析エンジン（Claude API）
    │      ホールの傾向分析・設定推測など
    │      あくまで「参考情報」として提示
    │
    └──→ ホールデータ（サイトセブン連携）
           リアルタイムの台データ取得
           天井付近の台を自動検知→プッシュ通知
```

---

## 重要な設計思想：判断基準の分離

このシステムでは **「確定情報」と「AI分析」を明確に分離** する。

### 確定情報（confidence: "confirmed"）

- 天井ゲーム数
- 期待値（ゲーム数別）
- 狙い目ライン
- やめどき
- ゾーン情報

これらは **人間が信頼できる外部ソースから取得し、手動またはClaude CWORKで整理してDBに登録** する。
AIが独自に計算・推測するものではない。

### AI分析（confidence: "estimated"）

- ホールごとの設定配分傾向
- 曜日・イベント日の傾向
- 特定機種の設定推測
- 「今日狙い目かも」という参考情報

これらは **サイトセブン等の実データをClaude APIで分析** して生成する。
ユーザーには「AI分析による参考情報」であることを明示する。

---

## データベース設計（Supabase / PostgreSQL）

### machines テーブル（確定情報）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | uuid | 主キー |
| name | text | 機種名（例: "北斗の拳"） |
| name_aliases | text[] | 別名・略称（例: ["北斗", "ほくと"]） |
| ceiling_game | integer | 天井ゲーム数 |
| target_line | integer | 狙い目ライン（このG数から打つ） |
| quit_point | text | やめどき（例: "AT後即やめ"） |
| zone_info | jsonb | ゾーン情報（任意） |
| expected_values | jsonb | ゲーム数別の期待値テーブル |
| memo | text | 補足情報 |
| confidence | text | "confirmed" 固定 |
| updated_at | timestamp | 最終更新日 |

#### expected_values の構造例

```json
{
  "0": -2500,
  "100": -1800,
  "200": -1000,
  "300": 200,
  "400": 1200,
  "500": 2800,
  "600": 4500,
  "700": 7200,
  "800": 12000
}
```

※ キー = 現在のゲーム数、値 = その地点からの期待値（円）

### halls テーブル（ホール情報）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | uuid | 主キー |
| name | text | ホール名 |
| area | text | エリア（例: "大阪市浪速区"） |
| site7_id | text | サイトセブンでのホールID（連携用） |
| created_at | timestamp | 登録日 |

### hall_analysis テーブル（AI分析）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | uuid | 主キー |
| hall_id | uuid | halls.id への外部キー |
| machine_name | text | 対象機種名 |
| analysis_text | text | 分析結果テキスト |
| data_period | text | 分析対象期間（例: "過去30日"） |
| confidence | text | "estimated" 固定 |
| generated_at | timestamp | 分析生成日 |

### users テーブル（LINEユーザー）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | uuid | 主キー |
| line_user_id | text | LINE ユーザーID |
| display_name | text | 表示名 |
| favorite_halls | uuid[] | お気に入りホールのID配列 |
| notify_enabled | boolean | プッシュ通知ON/OFF |
| notify_threshold | integer | 通知する期待値の下限（例: 3000円以上） |
| created_at | timestamp | 登録日 |

---

## LINE Bot の機能一覧

### 1. 期待値照会（メインの機能）

```
ユーザー: 「北斗 650」

Bot:
━━━━━━━━━━━━━━━
📊 北斗の拳  現在650G

【期待値】+4,500円
【天井】800G（残り150G）
【やめどき】AT後即やめ
━━━━━━━━━━━━━━━
```

**処理フロー:**

1. ユーザーのメッセージを解析（機種名 + ゲーム数を抽出）
2. `machines` テーブルから `name` または `name_aliases` で検索
3. `expected_values` から該当ゲーム数の期待値を取得
4. テンプレートに当てはめて返答

### 2. 写真判定（Claude Vision）

```
ユーザー: [データカウンターの写真を送信]

Bot:
━━━━━━━━━━━━━━━
📷 画像から読み取り

【機種】北斗の拳（推定）
【ゲーム数】650G
【期待値】+4,500円
【天井】800G（残り150G）
【やめどき】AT後即やめ
━━━━━━━━━━━━━━━
```

**処理フロー:**

1. 画像をClaude Vision APIに送信
2. 機種名・ゲーム数・BIG/REG回数を抽出
3. 以降は期待値照会と同じフロー

### 3. ホール傾向分析（AI分析）

```
ユーザー: 「マルハン新世界 傾向」

Bot:
━━━━━━━━━━━━━━━
💡 マルハン新世界 AI分析
   ※ 過去30日のデータに基づく参考情報です

・火曜と金曜に高設定が入りやすい傾向
・北斗の拳は角台に高設定が集中
・先週は回収傾向だったため今週は放出の可能性

分析日: 2026-03-24
━━━━━━━━━━━━━━━
```

### 4. お宝台プッシュ通知（サイトセブン連携）

```
[自動通知]
━━━━━━━━━━━━━━━
🔥 お宝台を検知！

マルハン新世界 北斗の拳 #35
現在 847G（天井 800G まで残り 53G）
期待値 +8,200円

※ 確定情報DBに基づく期待値です
━━━━━━━━━━━━━━━
```

**処理フロー（定期実行）:**

1. ユーザーのお気に入りホールを取得
2. サイトセブンから各ホールの台データを取得
3. 各台のゲーム数と `machines.target_line` を比較
4. 狙い目ラインを超えた台を検知
5. `expected_values` から期待値を算出
6. ユーザーの `notify_threshold` 以上ならLINEプッシュ通知

---

## メッセージ解析ルール

ユーザーの自然言語入力を以下のルールで解析する。

### テキストメッセージ

```
パターン1: 「{機種名} {ゲーム数}」
  例: "北斗 650" → 機種: 北斗の拳, G数: 650

パターン2: 「{機種名} {ゲーム数}G」
  例: "まどマギ 400G" → 機種: まどかマギカ, G数: 400

パターン3: 「{ホール名} 傾向」
  例: "マルハン新世界 傾向" → ホール傾向分析モード

パターン4: 「{機種名}」のみ
  例: "北斗" → 機種情報一覧を返す（天井・狙い目・やめどき）
```

### 画像メッセージ

- データカウンター写真 → Claude Visionで解析

### 解析にClaude APIを使う場合

テキスト解析が正規表現で難しい場合、Claude APIに以下のプロンプトを送る:

```
以下のメッセージからパチスロの機種名とゲーム数を抽出してください。
JSON形式で返してください。

メッセージ: "{ユーザーの入力}"

出力形式:
{
  "intent": "check_ev" | "check_trend" | "machine_info" | "unknown",
  "machine_name": "機種名 or null",
  "game_count": 数値 or null,
  "hall_name": "ホール名 or null"
}
```

---

## 技術スタック

| 要素 | 技術 | 費用 |
|------|------|------|
| フロントエンド | LINE Messaging API | 無料 |
| バックエンド | Node.js on Vercel | 無料枠 |
| データベース | Supabase（PostgreSQL） | 無料枠 |
| AI（テキスト解析・分析） | Claude API | 従量課金 |
| AI（画像解析） | Claude Vision API | 従量課金 |
| ホールデータ | サイトセブン | 月額500円 |
| 定期実行 | Vercel Cron Jobs | 無料枠 |

### 月額コスト見込み

| 項目 | 費用 |
|------|------|
| Vercel | 0円（無料枠） |
| Supabase | 0円（無料枠） |
| Claude API | 2,000〜5,000円（利用量次第） |
| サイトセブン | 500円 |
| LINE Messaging API | 0円（無料メッセージ枠内） |
| **合計** | **約2,500〜5,500円/月** |

---

## 開発フェーズ

### Phase 1A：最小限の動くもの

- [ ] Supabaseでデータベース構築
- [ ] machinesテーブルに主要機種を手動登録
- [ ] LINE Bot基本構築（Webhook受信 → 返答）
- [ ] テキスト解析（機種名 + G数 → 期待値返答）
- [ ] Vercelにデプロイ

### Phase 1B：AI機能追加

- [ ] Claude Vision連携（写真からデータ読み取り）
- [ ] Claude APIでメッセージ解析の精度向上
- [ ] 機種名のあいまい検索対応

### Phase 2：サイトセブン連携

- [ ] サイトセブンからデータ取得の仕組み
- [ ] お宝台の自動検知ロジック
- [ ] LINEプッシュ通知の実装
- [ ] ユーザー設定（お気に入りホール・通知閾値）

### Phase 3：AI分析機能

- [ ] ホールデータの蓄積
- [ ] Claude APIによる傾向分析
- [ ] 分析結果の保存と定期更新
- [ ] 分析結果の表示（確定情報と明確に分離）

---

## ディレクトリ構成（予定）

```
slot-hyena-bot/
├── api/
│   ├── webhook.js          # LINE Webhook エンドポイント
│   ├── cron/
│   │   └── check-halls.js  # 定期実行：お宝台チェック
│   └── lib/
│       ├── line.js          # LINE API ラッパー
│       ├── supabase.js      # Supabase クライアント
│       ├── claude.js         # Claude API ラッパー
│       ├── parser.js         # メッセージ解析
│       ├── ev-checker.js     # 期待値照会ロジック
│       └── hall-analyzer.js  # ホール傾向分析ロジック
├── package.json
├── vercel.json
└── .env                     # 環境変数（※gitに含めない）
```

### 環境変数

```
LINE_CHANNEL_SECRET=xxx
LINE_CHANNEL_ACCESS_TOKEN=xxx
SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx
ANTHROPIC_API_KEY=xxx
SITE7_SESSION=xxx
```

---

## 注意事項

- 期待値などの確定情報はAIが計算するものではない。信頼できる外部ソースから取得し、DBに登録したものを参照する
- AI分析結果は必ず「参考情報」であることをユーザーに明示する
- 特定のサイト名やソース名をコード内・ユーザー向け表示にハードコードしない
- ユーザーの個人情報（LINE ID等）は最小限の保持にとどめる

---

## 実装前に追加する要件（追記）

### 1. 規約・法務チェック（Phase 0）

Phase 1Aの前に、以下のチェックを完了してから開発開始する。

- [ ] サイトセブン連携方法が利用規約上問題ないことを確認
- [ ] LINE Messaging APIの送信上限・禁止事項・運用ルールを確認
- [ ] 取得データの保存期間・利用目的を明文化

> 備考: このフェーズが未完了の場合、Phase 2（外部データ連携）は着手しない。

### 2. 確定情報DBの更新運用

確定情報（`confidence = confirmed`）の信頼性を維持するため、データ更新時に出典情報と承認ログを保持する。

#### machines テーブル 追加カラム（推奨）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| source_url | text | 参照元URL |
| source_date | date | 参照元情報の公開日 |
| version | integer | データ版数（更新ごとに+1） |
| reviewed_by | text | 最終確認者 |
| effective_from | date | 適用開始日 |
| effective_to | date | 適用終了日（任意） |
| is_active | boolean | 現行版フラグ |
| source_meta | jsonb | 備考・参照元メタ情報 |

### 3. AI分析の再現性確保

AI分析（`confidence = estimated`）は結果再現と説明可能性のため、生成条件を保持する。

#### hall_analysis テーブル 追加カラム（推奨）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| model_name | text | 利用モデル名 |
| prompt_version | text | プロンプト版数 |
| input_snapshot_id | text | 入力データスナップショット識別子 |

### 4. 解析・期待値計算仕様の固定

実装ブレを防ぐため、以下を固定仕様とする。

- 機種名正規化: `machine_aliases`（別テーブル）で揺れを吸収し、`machines.id`へ解決
- 期待値補間方式: 100G刻みの中間は**線形補間**を標準とする
- 機種解決の信頼度が低い場合: 「候補提示→ユーザー確認」を挟む

#### machine_aliases テーブル（新規）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | uuid | 主キー |
| machine_id | uuid | machines.idへの外部キー |
| alias | text | 別名（例: 北斗, スマスロ北斗） |
| normalized_alias | text | 正規化済み別名 |
| priority | integer | 解決優先度 |

### 5. 通知の重複防止・静音時間

プッシュ通知の品質向上のため、重複排除と通知制御を導入する。

- 同一台・同一ゲーム数帯への重複通知を一定時間抑止
- ユーザーごとの静音時間（通知しない時間帯）を設定可能にする

#### users テーブル 追加カラム（推奨）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| timezone | text | 例: Asia/Tokyo |
| quiet_hours | jsonb | 例: {"start":"23:00","end":"08:00"} |

#### 通知重複管理テーブル（新規: notification_history）

| カラム名 | 型 | 説明 |
|---------|-----|------|
| id | uuid | 主キー |
| user_id | uuid | users.id |
| hall_id | uuid | halls.id |
| machine_id | uuid | machines.id |
| machine_number | text | 台番号 |
| game_count | integer | 通知時ゲーム数 |
| ev_value | integer | 通知時期待値 |
| dedupe_key | text | 重複判定キー |
| expires_at | timestamp | 再通知許可時刻 |
| sent_at | timestamp | 送信時刻 |

### 6. KPI（初期運用の測定指標）

MVP段階から以下を記録する。

- メッセージ解析成功率（意図分類・機種名抽出）
- 期待値照会の平均レスポンス時間
- 機種誤判定率（ユーザー修正発生率）
- 通知開封率・ブロック率

### 7. 開発順序の調整（推奨）

- **Phase 0**: 規約・法務チェック、データ更新運用ルール策定
- **Phase 1A**: テキスト照会のみでMVP公開（通知なし・対象機種限定）
- **Phase 1B**: あいまい検索・画像解析を追加
- **Phase 2**: 外部データ連携と通知機能
- **Phase 3**: AI分析機能（最後に追加）

