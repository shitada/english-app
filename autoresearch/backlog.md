# Autoresearch Backlog

Improvement ideas for the English Learning App, prioritized by importance.

## [HIGH] Test Coverage


## [HIGH] Speaking & Listening Features

- [ ] [BUG-HIGH] Conversationのダークモードでハイライト文字がまだ見えない — 前回修正したはずのキーフレーズ強調表示が、ダークモード時に依然として読みづらい/見えない状態。HighlightedMessage のスタイル（背景色・文字色）と CSS 変数の適用先（`color` 指定漏れ等）を再確認し、実際に dark テーマ適用時のコントラスト比を WCAG AA (4.5:1) 以上に修正。frontend/src/pages/Conversation.tsx と関連 CSS を見直すこと。
- [ ] [BUG-HIGH] Conversation で絵文字アイコン（笑顔絵文字など）がそのまま音声で読み上げられる — LLM 応答に含まれる絵文字（😊 等）が SpeechSynthesis に渡され「smiling face」等と読まれる。useSpeechSynthesis に渡す前のテキストから絵文字／装飾アイコンを除去するサニタイズ関数（Unicode emoji ranges を strip）を追加。表示テキストには絵文字を残しても良いが、speak() 用の文字列は削除版にする。さらにシステムプロンプト側（app/prompts.py の conversation 系）で「Do not include emojis or decorative icons in your reply.」を追記。
- [ ] [PERF-HIGH] Conversation の応答が遅い（15秒前後） — POST /api/conversation/start や /reply で 6〜16秒かかっている（ログ参照）。改善案: (1) システムプロンプトを短縮しトークン数削減、(2) start で2回呼んでいる Copilot 呼び出しを1回にまとめる、(3) ストリーミング応答 (SSE / chunked) を導入して最初の文字が出るまでの体感速度を改善、(4) 並列化可能な処理（feedback 生成と返答生成）を asyncio.gather で同時実行、(5) Session created の重複（毎回0.7s + 0.1s）を warm pool / connection reuse で削減。最低1つは実装し、p50 応答時間を計測してログに記録。


## [MEDIUM] Autoresearch Infrastructure

- [x] [INFRA] iter 欠損検出 — invocation がタイムアウト/中断で results.tsv に書き込めなかった iter（例: 599-601, 610, 614）を audit.sh が検出するよう実装済（GAP check）。
- [ ] [INFRA] AGENT_TRACE 全ゼロ警告 — orchestrator が subagent を一切呼ばず自己実装したケース（AGENT_TRACE iter=N proposer=0 coder=0 tester=0 evaluator=0）を audit.sh で error 扱いとし、prescriber に自動通知して orchestrator プロンプトの強化案を出させる。
- [ ] [INFRA] orchestrator invocation 境界での agent_skip 多発対応 — 10 iter ごとの invocation 境界で orchestrator が subagent 呼出しルールを忘れる傾向あり。run.sh の prompt 冒頭に「毎 iter で必ず4 subagent を順序通り呼べ」を再投入する仕組みを追加検討。


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

