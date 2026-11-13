<div align="center">

# AgentCorp

**AI スタートアップシミュレーター。LLM に会社と資金とチームを渡し、採用・解雇・ピボット・資金調達、そして（たいてい）資金切れまでを見届けましょう。**

スタートアップ経営が一番うまいのは GPT、Claude、Gemini、Llama のどれ？ 同じ市場で競わせて確かめましょう。

[English](../../README.md) · [Русский](README.ru.md) · [Қазақша](README.kk.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · [한국어](README.ko.md) · [Español](README.es.md) · **日本語**

<img src="../img/dashboard.png" alt="AgentCorp" width="100%">

</div>

## なぜ作ったか

各社はトークン（◈）建ての口座、給与、バーンレート、ランウェイを持ちます。CEO は LLM か組み込み戦略です。数週間ごとに注力分野、採用と解雇、価格、マーケティング費、ピボットや資金調達を決めます。世界はそれに応えます：顧客は増えたり去ったり、エンジニアは出荷したり遅れたり、投資家は出資したり断ったり。スタートアップのドラマであり、長期的な意思決定のベンチマークでもあります：104 週、スコアは企業価値です。

## クイックスタート

キー不要：4 つの組み込み戦略がデモリーグで戦います。

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2 demo
```

初回起動ではブラウザのセットアップが開き、ローカルの Ollama を見つけ、キーを確認し、各社の CEO を選べます。

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2
```

Windows: `setup.bat` · macOS / Linux: `./setup.sh`

## 無料・カード不要

ブラウザの「無料で始める」ボタン、またはターミナルの `agentcorp setup --free` は無料モデルだけを選びます：ローカルの Ollama、Groq と Gemini の無料枠、OpenRouter の無料モデル（`:free` 付き）。モデル名はコードに書かれておらず、一覧は各プロバイダーの API から取得します。

```bash
agentcorp setup --free
```

## 主な機能

- 給与、ランウェイ、採用と解雇、士気、競合への転職
- タスクマーケット：CEO が報酬付きタスクを出し、社員が入札
- 評価面談、四半期ごとの取締役会、失敗後の CEO 交代
- シードからシリーズ E までの資金調達、ブリッジと持分の希薄化
- 共有市場：同じ分野の会社が同じ顧客を奪い合う
- ダッシュボード：順位表、企業価値レース、損益、組織図、社内 Slack、タイムライン、市場ショック
- 取締役会のリプレイ、ピッチ資料、追悼記事または成功ストーリーのカード（PNG）、シーズン動画（WebM）
- シーズンモード：シードとシナリオを変えた複数レースとポイント表
- 安全性：プロンプトの隔離、トークン上限、レート制限、キーはログやリプレイに残らない

## コマンド

```text
agentcorp                      setup / league
agentcorp setup [--web|--free]
agentcorp models <openai|anthropic|gemini|openrouter|groq|ollama>
agentcorp league --brains <a,b,…> [--scenario ai-winter]
agentcorp season --brains <a,b,…> --runs 5
agentcorp offline
agentcorp replay <file.json>  ·  agentcorp export <file.json>  ·  agentcorp pitch <file.json>
```

## キーとセキュリティ

キーはお使いのコンピューターの `.agentcorp/config.json` にのみ保存されます。このフォルダーは git の対象外で、キーはログ・エラー・リプレイから削除されます。ダッシュボードのサーバーは 127.0.0.1 でのみ待ち受けます。

---

英語の完全なドキュメント： [README.md](../../README.md) · MIT
