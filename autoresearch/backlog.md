# Autoresearch Backlog

Improvement ideas for the English Learning App, prioritized by importance.

## [HIGH] Test Coverage


## [HIGH] Speaking & Listening Features

- [x] [BUG-HIGH] Conversationのダークモードでハイライト文字がまだ見えない — HighlightedMessage内の `--card-bg` → `--bg-card` 修正、CSS に `--card-bg` エイリアス追加、ツールチップ背景とリトライボタン文字色を CSS 変数化。
- [x] [BUG-HIGH] Conversation で絵文字アイコンがそのまま音声で読み上げられる — sanitizeForSpeech() 関数が speak/enqueue 両方で適用済。config.yaml の conversation_partner に「Do not include emojis」追記済。
- [x] [PERF-HIGH] Conversation の応答が遅い（15秒前後） — iter 684 でプロンプトtrim実施（MAX_TURNS 16→10, 240ch per-msg cap）。SSE ストリーミングも導入済み。残りの最適化（並列化、connection reuse等）は継続検討。


## [MEDIUM] Autoresearch Infrastructure

- [x] [INFRA] iter 欠損検出 — invocation がタイムアウト/中断で results.tsv に書き込めなかった iter（例: 599-601, 610, 614）を audit.sh が検出するよう実装済（GAP check）。
- [x] [INFRA] AGENT_TRACE 全ゼロ警告 — audit.sh に section 3b として追加済。proposer=0 coder=0 tester=0 evaluator=0 を検出し `agent_trace_all_zero` error として report。
- [ ] [INFRA] orchestrator invocation 境界での agent_skip 多発対応 — 10 iter ごとの invocation 境界で orchestrator が subagent 呼出しルールを忘れる傾向あり。run.sh の prompt 冒頭に「毎 iter で必ず4 subagent を順序通り呼べ」を再投入する仕組みを追加検討。
- [ ] [INFRA] proposer の Feature 分類問題 — 新機能を全て `test` や `bugfix` カテゴリで提出する傾向あり（iter 670-689 で Feature比率0%）。proposer プロンプトに「新しいページ/コンポーネント/ドリル追加は type: feature とすること」を明記する改善を検討。


## [MEDIUM] Feature Improvements


## [MEDIUM] Code Quality & Bug Fixes


## [LOW] UX & Frontend


## [LOW] Infrastructure


## [NEW] Ideas for Future Iterations


## [HIGH] Refactoring & Code Quality


## [HIGH] Speaking & Listening Features


## [MEDIUM] Feature Improvements


## [MEDIUM] Performance & Reliability


## [LOW] UX & Frontend


## [NEW] Features from Iteration 315+


## [NEW] Iterations 351–354


## [NEW] Iterations 357–359


## [NEW] Iterations 360+


## [NEW] Iterations 371–373


## [NEW] Iteration 374


## [NEW] Iterations 375–376


## [NEW] Iterations 377–378


## [NEW] Iteration 379


## [NEW] Iteration 381


## [NEW] Iteration 383–384


## [NEW] Iterations 385–386


## [NEW] Iterations 387–388


## [NEW] Iteration 389


## [NEW] Iteration 390


## [NEW] Iterations 391–392


## [NEW] Iterations 393–394


## [NEW] Iterations 395–396


## [NEW] Iteration 398


## [NEW] Iterations 399–400


## [NEW] Iterations 401–402


## [NEW] Iterations 403–404



## [NEW] Iterations 405–406


## [NEW] Iterations 407–408


## [NEW] Iterations 411–412



## [NEW] Iterations 415–416


## [NEW] Iterations 497–498


## [NEW] Iterations 499–500

