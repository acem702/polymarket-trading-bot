# PolyPulse Documentation — Polymarket Trading Bot & Arbitrage Guide

[English](#english) | [中文](#中文)

---

## English

Welcome to the **PolyPulse Polymarket trading bot** documentation. This is a comprehensive guide to help you set up your Polymarket bot for automated trading, strategy backtesting, and arbitrage execution.

This folder is a **step-by-step guide** from zero to running live strategies with your Polymarket trading bot. Read the documents **in order** the first time. You can jump back to any section later.

---

### Roadmap — Get Your Polymarket Bot Running

```
Install → First run → Dashboard → Backtest → Live trade → Configure → Production
   1          2           3           4           5           6           7–8
```

---

### Documents

#### Getting started with your Polymarket bot

1. **[01 — Installation](01-installation.md)**  
   Set up Node.js, clone your Polymarket bot repository, `npm install`, first build.

2. **[02 — First run](02-first-run.md)**  
   Start your Polymarket trading bot with `npm run dev`, verify collector connection.

#### Using your Polymarket trading bot

3. **[03 — Dashboard guide](03-dashboard.md)**  
   Master the Polymarket bot dashboard: header controls, charts, arbitrage opportunity detection.

4. **[04 — Strategies](04-strategies.md)**  
   Learn all 3 Polymarket arbitrage & trading strategies: 45c Dual, 90c Momentum, PTB Deviation.

5. **[05 — Live trading](05-live-trading.md)**  
   Configure your Polymarket bot for real trading: wallet setup, live order execution.

#### Reference — Advanced Polymarket Bot Setup

6. **[06 — Configuration](06-configuration.md)**  
   Complete `.env` reference for configuring your Polymarket arbitrage bot.

7. **[07 — Production & data](07-production-and-data.md)**  
   Deploy your Polymarket bot in production with PM2, manage historical data, API reference.

8. **[08 — Troubleshooting](08-troubleshooting.md)**  
   Fix common Polymarket bot errors and connection issues.

---

### Glossary

| Term | Meaning |
|------|---------|
| **UP / YES** | Bet that price goes up in the period |
| **DOWN / NO** | Bet that price goes down in the period |
| **PTB** | Price to beat — Chainlink reference at period open |
| **CLOB** | Polymarket order book API (where limit orders go) |
| **Paper mode** | Signals fire but no real orders (safe for testing) |
| **Slug** | Market id for one period, e.g. `btc-updown-5m-1781882100` |
| **GTD** | Good-till-date order — expires at period end |

---

## 中文

欢迎使用 **PolyPulse Polymarket 交易机器人**文档。这是一份综合指南，帮助你为自动化交易、策略回测和套利执行设置你的 Polymarket 机器人。

本文件夹是一份**分步指南**，从零开始到运行你的 Polymarket 交易机器人的实时策略。第一次阅读时，请**按顺序**阅读这些文档。之后你可以跳回任何部分。

---

### 路线图 — 让你的 Polymarket 机器人运行起来

```
安装 → 首次运行 → 仪表板 → 回测 → 实时交易 → 配置 → 生产
  1        2        3       4       5        6      7–8
```

---

### 文档

#### 开始使用你的 Polymarket 机器人

1. **[01 — 安装](01-installation.md)**  
   设置 Node.js、克隆你的 Polymarket 机器人存储库、`npm install`、首次构建。

2. **[02 — 首次运行](02-first-run.md)**  
   使用 `npm run dev` 启动你的 Polymarket 交易机器人、验证收集器连接。

#### 使用你的 Polymarket 交易机器人

3. **[03 — 仪表板指南](03-dashboard.md)**  
   掌握 Polymarket 机器人仪表板：标题控件、图表、套利机会检测。

4. **[04 — 策略](04-strategies.md)**  
   学习所有 3 个 Polymarket 套利和交易策略：45c 双重、90c 动量、PTB 偏差。

5. **[05 — 实时交易](05-live-trading.md)**  
   配置你的 Polymarket 机器人进行实时交易：钱包设置、实时订单执行。

#### 参考 — 高级 Polymarket 机器人设置

6. **[06 — 配置](06-configuration.md)**  
   完整的 `.env` 参考用于配置你的 Polymarket 套利机器人。

7. **[07 — 生产和数据](07-production-and-data.md)**  
   使用 PM2 在生产环境中部署你的 Polymarket 机器人、管理历史数据、API 参考。

8. **[08 — 故障排除](08-troubleshooting.md)**  
   修复常见 Polymarket 机器人错误和连接问题。

---

### 术语表

| 术语 | 含义 |
|------|---------|
| **UP / YES** | 赌注价格在该期间上升 |
| **DOWN / NO** | 赌注价格在该期间下降 |
| **PTB** | 待击败价格 — 期间开始时的 Chainlink 参考价格 |
| **CLOB** | Polymarket 订单簿 API（限价订单所在位置） |
| **模拟模式** | 信号触发但没有真实订单（安全的测试） |
| **Slug** | 一个期间的市场 ID，例如 `btc-updown-5m-1781882100` |
| **GTD** | 有效期订单 — 在期间结束时过期 |
