<div align="center">

# AgentCorp

**Un simulateur de startups IA. Confiez à un LLM une entreprise, un compte en banque et une équipe, et regardez-le recruter, licencier, pivoter, lever des fonds et (souvent) manquer d’argent.**

Quel modèle dirige le mieux une startup : GPT, Claude, Gemini ou Llama ? Mettez-les sur le même marché et découvrez-le.

[English](../../README.md) · [Русский](README.ru.md) · [Қазақша](README.kk.md) · **Français** · [简体中文](README.zh.md) · [한국어](README.ko.md) · [Español](README.es.md) · [日本語](README.ja.md)

<img src="../img/dashboard.png" alt="AgentCorp" width="100%">

</div>

## Pourquoi

Chaque entreprise a un solde en jetons (◈), une masse salariale, un burn et un runway. Le CEO est un LLM ou une stratégie intégrée. Toutes les quelques semaines, il choisit sa priorité, qui recruter ou licencier, son prix, son budget marketing, s’il faut pivoter ou lever des fonds. Le monde répond : les clients arrivent ou partent, les ingénieurs livrent ou ratent les échéances, les investisseurs signent ou déclinent. C’est un drame de startup et un benchmark de décision à long terme : 104 semaines, et le score, c’est la valorisation.

## Démarrage rapide

Sans clé : quatre stratégies intégrées jouent la ligue de démo.

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2 demo
```

Le premier lancement ouvre la configuration dans le navigateur : elle détecte un Ollama local, vérifie les clés et vous fait choisir le CEO de chaque entreprise.

```bash
npx --yes github:bitovvnew/agentcorp#v0.1.2
```

Windows: `setup.bat` · macOS / Linux: `./setup.sh`

## Gratuit, sans carte bancaire

Le bouton « Configuration gratuite » du navigateur ou `agentcorp setup --free` dans le terminal ne choisissent que des modèles gratuits : Ollama en local, les offres gratuites de Groq et Gemini, et les modèles gratuits d’OpenRouter (suffixe `:free`). Aucun nom de modèle n’est codé en dur : la liste vient de l’API du fournisseur.

```bash
agentcorp setup --free
```

## Au programme

- Salaires, runway, recrutements et licenciements, moral et départs chez les concurrents
- Place de marché des tâches : le CEO publie des primes, les employés enchérissent
- Évaluations, conseil d’administration chaque trimestre, éviction du CEO après un échec
- Levées du Seed à la Série E, bridges et dilution
- Marché partagé : les entreprises d’un même segment se disputent les clients
- Tableau de bord : classement, course aux valorisations, P&L, organigramme, Slack, chronologie, chocs de marché
- Rediffusion des conseils, pitch deck, nécrologie ou success story (PNG), vidéo de la saison (WebM)
- Mode saison : plusieurs courses sur des graines et scénarios, tableau des points
- Sécurité : isolation des prompts, plafonds de jetons, limitation de débit, clés absentes des journaux et rediffusions

## Commandes

```text
agentcorp                      setup / league
agentcorp setup [--web|--free]
agentcorp models <openai|anthropic|gemini|openrouter|groq|ollama>
agentcorp league --brains <a,b,…> [--scenario ai-winter]
agentcorp season --brains <a,b,…> --runs 5
agentcorp offline
agentcorp replay <file.json>  ·  agentcorp export <file.json>  ·  agentcorp pitch <file.json>
```

## Clés et sécurité

Les clés sont stockées uniquement dans `.agentcorp/config.json` sur votre ordinateur. Ce dossier est ignoré par git, et les clés sont retirées des journaux, erreurs et rediffusions. Le serveur du tableau de bord n’écoute que 127.0.0.1.

---

Documentation complète en anglais : [README.md](../../README.md) · MIT
