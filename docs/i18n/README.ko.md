<div align="center">

# AgentCorp

**AI 스타트업 시뮬레이터. LLM에게 회사와 통장, 팀을 맡기고 채용, 해고, 피벗, 투자 유치, 그리고 (대개) 파산하는 모습을 지켜보세요.**

스타트업을 가장 잘 운영하는 모델은 GPT, Claude, Gemini, Llama 중 누구일까요? 한 시장에 풀어 놓고 확인해 보세요.

[English](../../README.md) · [Русский](README.ru.md) · [Қазақша](README.kk.md) · [Français](README.fr.md) · [简体中文](README.zh.md) · **한국어** · [Español](README.es.md) · [日本語](README.ja.md)

<img src="../img/dashboard.png" alt="AgentCorp" width="100%">

</div>

## 왜 만들었나

모든 회사에는 토큰(◈) 잔고, 급여, 소진율, 런웨이가 있습니다. CEO는 LLM이거나 내장 전략입니다. 몇 주마다 무엇에 집중할지, 누구를 채용하고 내보낼지, 가격과 마케팅 비용, 피벗과 투자 유치를 결정합니다. 세상은 반응합니다: 고객이 오고 떠나며, 엔지니어는 출시하거나 일정을 놓치고, 투자자는 수표를 쓰거나 거절합니다. 스타트업 드라마이자 장기 의사결정 벤치마크입니다: 104주, 점수는 기업 가치입니다.

## 빠른 시작

키 없이: 내장 전략 네 가지가 데모 리그를 치릅니다.

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2 demo
```

처음 실행하면 브라우저 설정이 열립니다. 로컬 Ollama를 찾고 키를 확인한 뒤 회사마다 CEO를 고르게 합니다.

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2
```

Windows: `setup.bat` · macOS / Linux: `./setup.sh`

## 무료, 카드 없이

브라우저의 「무료로 시작」 버튼이나 터미널의 `agentcorp setup --free`는 무료 모델만 고릅니다: 로컬 Ollama, Groq와 Gemini 무료 등급, OpenRouter 무료 모델(`:free` 접미사). 모델 이름은 코드에 하드코딩되지 않으며, 목록은 제공업체 API에서 가져옵니다.

```bash
agentcorp setup --free
```

## 주요 기능

- 급여, 런웨이, 채용과 해고, 사기, 경쟁사로의 이직
- 작업 마켓: CEO가 보상 과제를 올리고 직원이 입찰
- 성과 평가, 분기별 이사회, 실패 후 CEO 교체
- 시드부터 시리즈 E까지의 투자, 브리지 투자와 지분 희석
- 공유 시장: 같은 분야 회사들이 고객을 나눠 가짐
- 대시보드: 리그 순위, 가치 경쟁, 손익, 조직도, 회사 Slack, 타임라인, 시장 충격
- 이사회 다시보기, 피치 덱, 부고 또는 성공 스토리 카드(PNG), 시즌 영상(WebM)
- 시즌 모드: 시드와 시나리오별 여러 경기와 포인트 표
- 보안: 프롬프트 격리, 토큰 상한, 요청 제한, 키는 로그와 리플레이에 남지 않음

## 명령어

```text
agentcorp                      setup / league
agentcorp setup [--web|--free]
agentcorp models <openai|anthropic|gemini|openrouter|groq|ollama>
agentcorp league --brains <a,b,…> [--scenario ai-winter]
agentcorp season --brains <a,b,…> --runs 5
agentcorp offline
agentcorp replay <file.json>  ·  agentcorp export <file.json>  ·  agentcorp pitch <file.json>
```

## 키와 보안

키는 내 컴퓨터의 `.agentcorp/config.json`에만 저장됩니다. 이 폴더는 git에서 제외되며 키는 로그, 오류, 리플레이에서 지워집니다. 대시보드 서버는 127.0.0.1에서만 동작합니다.

---

전체 영어 문서: [README.md](../../README.md) · MIT
