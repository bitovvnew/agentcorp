<div align="center">

# AgentCorp

**一个 AI 创业公司模拟器。给大模型一家公司、一笔钱和一支团队，看它招人、裁员、转型、融资，然后（通常）把钱花光。**

哪个模型最会经营创业公司：GPT、Claude、Gemini 还是 Llama？把它们放进同一个市场比一比。

[English](../../README.md) · [Русский](README.ru.md) · [Қазақша](README.kk.md) · [Français](README.fr.md) · **简体中文** · [한국어](README.ko.md) · [Español](README.es.md) · [日本語](README.ja.md)

<img src="../img/dashboard.png" alt="AgentCorp" width="100%">

</div>

## 为什么做这个

每家公司都有以代币（◈）计的账户、工资、烧钱速度和跑道。CEO 是一个大模型或内置策略。每隔几周，它决定重点做什么、招谁裁谁、怎么定价、花多少营销费、要不要转型和融资。世界随之回应：客户来了又走，工程师按时交付或延期，投资人签支票或拒绝。这既是一出创业剧，也是长期决策的基准测试：104 周，比分就是估值。

## 快速开始

无需密钥：四种内置策略参加演示联赛。

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2 demo
```

首次运行会在浏览器中打开设置：自动发现本地 Ollama、校验密钥，并让你为每家公司选择 CEO。

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2
```

Windows: `setup.bat` · macOS / Linux: `./setup.sh`

## 免费，无需信用卡

浏览器里的“免费开始”按钮或终端中的 `agentcorp setup --free` 只会选择免费模型：本地 Ollama、Groq 与 Gemini 的免费额度，以及 OpenRouter 的免费模型（后缀 `:free`）。代码中不写死任何模型名，列表来自各服务商的 API。

```bash
agentcorp setup --free
```

## 包含什么

- 工资、跑道、招聘与裁员、士气以及跳槽到竞争对手
- 任务市场：CEO 发布悬赏，员工竞标
- 绩效评估、每季度董事会、失败后撤换 CEO
- 从种子轮到 E 轮的融资、过桥贷款与股权稀释
- 共享市场：同一赛道的公司争夺同一批客户
- 仪表盘：排行榜、估值竞赛、损益、组织架构、公司 Slack、时间线、市场冲击
- 董事会回放、路演 PPT、讣告或成功故事卡片（PNG）、赛季视频（WebM）
- 赛季模式：多个种子与场景的多场比赛和积分榜
- 安全：提示词隔离、代币上限、限流，密钥不会出现在日志和回放中

## 命令

```text
agentcorp                      setup / league
agentcorp setup [--web|--free]
agentcorp models <openai|anthropic|gemini|openrouter|groq|ollama>
agentcorp league --brains <a,b,…> [--scenario ai-winter]
agentcorp season --brains <a,b,…> --runs 5
agentcorp offline
agentcorp replay <file.json>  ·  agentcorp export <file.json>  ·  agentcorp pitch <file.json>
```

## 密钥与安全

密钥只保存在你电脑上的 `.agentcorp/config.json` 中。该目录已被 git 忽略，密钥会从日志、错误和回放中抹去。仪表盘服务只监听 127.0.0.1。

---

完整英文文档： [README.md](../../README.md) · MIT
