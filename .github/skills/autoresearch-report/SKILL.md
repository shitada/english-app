---
name: autoresearch-report
description: "Generate a detailed report of recent autoresearch iterations. Use when the user asks about iteration results, autoresearch run status, what changed recently, or for a summary of the latest improvements. Also use when asked about feature vs bugfix ratio, test counts, agent invocations, or Playwright test quality."
allowed-tools: shell
---

# Autoresearch レポートスキル

autoresearch イテレーション結果のフォーマット済みレポートを生成する。
**出力は全て日本語で行うこと。**

## How to use

Run the `report.sh` script from this skill's directory to collect raw data, then format it into a readable report.

### Step 1: Determine the iteration range

If the user specifies a range (e.g., "last 10 iterations" or "iter 250-269"), use that.
Otherwise, determine the latest iteration from results.tsv:

```bash
tail -1 autoresearch/results.tsv | cut -f1
```

For "latest run", look at the most recent 20 iterations. For "all", use the full range.

### Step 2: Run the report script

```bash
bash .github/skills/autoresearch-report/report.sh -f <FROM> -t <TO>
```

### Step 3: Format the output

Parse the script output and present it as a well-formatted report with these sections:

#### イテレーション詳細テーブル

Format each `ITER|...` line as a table row:

| iter | カテゴリ | スコア | 採否 | 説明 | 修正箇所 | 所要時間 |
|------|---------|--------|------|------|---------|---------|

- **カテゴリ**: `feature` は太字、`bugfix` は通常、`perf` はイタリック
- **採否**: `keep`/`kept` = ✅, `discard` = ❌
- **修正箇所**: report.sh の出力にある変更ファイルリスト（パイプ区切りの最後から2番目のフィールド）を、ワークスペース相対パスのマークダウンリンクとして表示。例: [app/dal/dashboard.py](app/dal/dashboard.py), [frontend/src/pages/Conversation.tsx](frontend/src/pages/Conversation.tsx)
- **説明**: report の detailed description を使用（commit body 含む）
- **所要時間**: 合計秒数を表示

#### サマリー統計

`=== SUMMARY ===` セクションから以下を表示:
- 合計イテレーション数、採用/棄却数と率
- Feature vs bugfix 比率（20%未満の場合はハイライト）
- スコア統計（平均、最小、最大）
- テスト数推移（開始 → 終了、増減）

#### Premium リクエスト数

`=== PREMIUM REQUESTS ===` から合計数を表示。

#### エージェント呼出し状況

`=== AGENT INVOCATIONS ===` から:
- Proposer/Tester/Evaluator の呼出し率を表示
- `AGENT_SKIP` のあるイテレーションとスキップされたエージェントを一覧
- スキップ率が20%超のエージェントには警告を表示

#### Playwright テスト詳細

`=== PLAYWRIGHT TEST DETAILS ===` から:
- Playwright テストが実行されたイテレーションを表示
- イテレーションごとの使用ツールを一覧
- 5ツール未満のイテレーションは「浅いテスト」としてフラグ
- テスト未実行の場合、それが想定通りか（全て bugfix、フロントエンド変更なし）を注記

#### 監査所見

`=== AUDIT FINDINGS ===` から:
- JSON をパースし、重大度順（error > warning）で表示
- 根本原因と確信度を含める
- HIGH 確信度の問題には改善案を提示

#### 最頻変更ファイル

`=== MOST CHANGED FILES ===` から:
- 変更頻度の高いファイル上位5件をリスト表示

#### バックログ状況

`=== BACKLOG STATUS ===` から:
- 完了数/残数を表示
- 残りタスクを一覧表示

### Step 4: 分析

フォーマット済みデータの後に、簡潔な分析セクションを追加:

- **ハイライト**: うまくいった点（高スコア、feature 完了、テスト追加）
- **懸念点**: 発見された問題（エージェントスキップ、低スコア、棄却率）
- **改善提案**: データに基づく具体的な次のアクション
