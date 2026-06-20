# 04 — Strategies

[English](#english) | [中文](#中文)

## English

PolyPulse includes three strategies. Each can **backtest** on saved data and **run live** from the dashboard.

---

## Overview

| Strategy | Idea | Orders per period | When it acts |
|----------|------|-------------------|--------------|
| **45c Dual** | Buy both sides cheap | 2 (UP + DOWN) | At period **open** |
| **90c Momentum** | Follow Binance spike | 0–1 | Last **3 minutes** |
| **PTB Deviation** | Fade PTB mispricing | 0–1 | Last **60 seconds** |

All strategies assume Polymarket **up/down** markets for the selected asset and timeframe.

---

## Strategy 1: 45c Dual

### Logic

At the **start of each period**, place two resting limit **BUY** orders:

- **UP (YES)** @ limit price (default **0.45**)
- **DOWN (NO)** @ limit price (default **0.45**)

Orders rest until **period end** (GTD — not cancelled early). They fill when the market ask drops to your limit or below.

If both sides fill and one wins at settlement, the winning side pays $1 per share — classic dual-side capture when combined cost < $1.

### Parameters (dashboard)

| Field | Default | Description |
|-------|---------|-------------|
| Shares | 5 | Size per side |
| Limit price | 0.45 | Max price for each limit buy |

### Live behavior

1. Click **Live trading** on the 45c Dual card
2. On period roll, bot posts UP + DOWN limits in parallel
3. Status: `live — resting UP+DOWN @ 0.45 until period end`
4. Signals show order IDs: `[UP …] [DOWN …]`

### Backtest

Simulates: first moment in the period when ask ≤ limit counts as fill at that ask price. Needs `ask_bid_prices` JSONL for the date range.

---

## Strategy 2: 90c Momentum

### Logic

Uses **Binance** price only (not Coinbase).

1. **Wait** until the last **180 seconds** (3 min) of the period — configurable as “Signal tail”
2. Track a rolling **3 second** window of Binance prices
3. Measure:
   - **Up move** = current price − window low
   - **Down move** = window high − current price
4. When move ≥ **threshold ($)** → buy the matching side if ask ≤ **0.90**
5. **One signal per period** (first qualifying move wins)

Example (BTC, threshold $20): Binance jumps $25 in 3s near period end → buy YES if YES ask ≤ 0.90.

### Parameters

| Field | Default | Description |
|-------|---------|-------------|
| Shares | 5 | Order size |
| Limit price | 0.90 | Max ask to enter |
| Threshold ($) | Asset-specific (BTC ≈ 20) | Min Binance move in USD |
| Window (s) | 3 | Momentum lookback |
| Signal tail (s) | 180 | Only trade in last N seconds of period |

Default thresholds are pre-filled per asset when you switch coins.

### Live behavior

- Early period: `live — waiting (Xs to tail)`
- In tail: tracks momentum, shows up/down move in status
- On signal: single limit buy at current ask

### Backtest

Needs Binance price JSONL + ask/bid history for the period.

---

## Strategy 3: PTB Deviation

### Logic

Compares **Binance spot** to **Chainlink PTB** (price to beat).

1. **Wait** until the last **60 seconds** of the period
2. If `|Binance − PTB| > threshold ($)`:
   - Binance **above** PTB → buy **YES** (expect up resolution)
   - Binance **below** PTB → buy **NO** (expect down resolution)
3. Enter only if ask ≤ **0.99**
4. **One signal per period**

### Parameters

| Field | Default | Description |
|-------|---------|-------------|
| Shares | 5 | Order size |
| Limit price | 0.99 | Max ask to enter |
| Threshold ($) | Asset + TF specific | Min deviation in USD |
| Signal window (s) | 60 | Only scan last N seconds |

### Live behavior

- Uses `cl_ptb_deviation` from collector live frame
- Status shows current deviation vs required threshold

### Backtest

Needs `spread/cl_ptb_deviation/{ASSET}_{tf}.jsonl` and ask/bid data.

---

## How to run a backtest (step by step)

1. Run collector for at least the days you want to test
2. Open dashboard → pick **coin** and **timeframe**
3. Set **Start** and **End** dates (Eastern) at top of strategy panel
4. Select strategy tab → adjust parameters
5. Click **Backtest**
6. Read summary + results table

If you get 0 trades, either no signals fired in that range or data is missing for those dates.

---

## How to run live (step by step)

1. Complete [02 — First run](02-first-run.md) — collector + dashboard connected
2. For **real orders**, complete [05 — Live trading](05-live-trading.md) first
3. Pick coin + timeframe
4. Select strategy → click **Live trading**
5. Watch live panel + **Live trading history** table
6. Click **Stop live** to end the runner

**Important:** Stopping live does **not** cancel open orders on Polymarket. 45c Dual GTD orders expire at period end automatically.

---

## Running multiple strategies

You can run **one live runner per (strategy, asset, timeframe)** at the same time:

- 45c Dual on BTC 5m
- 90c Momentum on BTC 5m
- PTB on ETH 5m

All three on BTC 5m simultaneously is supported but uses more capital and API load.

---

## Next step

Set up real orders in **[05 — Live trading](05-live-trading.md)**.

---

## 中文

PolyPulse包含三个策略。每个都可以在保存的数据上**回测**并从仪表板**实时运行**。

---

## 概述

| 策略 | 想法 | 每个期间的订单 | 何时行动 |
|----------|------|-------------------|-------------------|
| **45¢双重** | 便宜买入双方 | 2个（上+下） | 期间**开始** |
| **90¢动量** | 跟踪Binance尖峰 | 0–1 | 最后**3分钟** |
| **PTB偏差** | 抗击PTB错误定价 | 0–1 | 最后**60秒** |

所有策略都假设所选资产和时间框架的Polymarket**上/下**市场。

---

## 策略1：45¢双重

### 逻辑

在**每个期间的开始**，下达两个静止限制**买入**订单：

- **上升（是）** @ 限制价格（默认**0.45**）
- **下降（否）** @ 限制价格（默认**0.45**）

订单静止至**期间结束**（GTD—不会提前取消）。当市场问价下降到您的限制价或以下时，它们将被填充。

### 参数（仪表板）

| 字段 | 默认值 | 描述 |
|-------|---------|-----------|
| 份额 | 5 | 每方大小 |
| 限制价格 | 0.45 | 每个限制买入的最高价格 |

### 实时行为

1. 在45¢双重卡上单击**实时交易**
2. 在期间滚动上，机器人并行发布UP+DOWN限制
3. 状态：`实时—静止UP+DOWN @ 0.45直到期间结束`
4. 信号显示订单ID：`[UP...][DOWN...]`

### 回测

模拟：期间内第一个问价≤限制的时刻被视为以该问价填充。需要日期范围的`ask_bid_prices` JSONL。

---

## 策略2：90¢动量

### 逻辑

仅使用**Binance**价格（不是Coinbase）。

1. **等待**直到期间的最后**180秒**（3分钟）—可配置为"信号尾"
2. 跟踪Binance价格的滚动**3秒**窗口
3. 测量：
   - **向上移动** = 当前价格 − 窗口低
   - **向下移动** = 窗口高 − 当前价格
4. 当移动≥**阈值（$）**→如果问价≤**0.90**，购买匹配的一方
5. **每个期间一个信号**（第一个符合条件的移动获胜）

示例（BTC，阈值$20）：Binance在期间末附近3秒内跳升$25 → 如果是问价≤0.90则购买是。

### 参数

| 字段 | 默认值 | 描述 |
|-------|---------|----------------------|
| 份额 | 5 | 订单大小 |
| 限制价格 | 0.90 | 最高问价进入 |
| 阈值（$） | 资产特定（BTC≈20） | Binance最小移动USD |
| 窗口（秒） | 3 | 动量回顾 |
| 信号尾（秒） | 180 | 仅在期间最后N秒交易 |

### 实时行为

- 早期：`实时—等待（X秒到尾）`
- 在尾部：跟踪动量，显示状态中的上/下移动
- 信号上：以当前问价的单个限制买入

### 回测

需要Binance价格JSONL +该期间的问价/买价历史。

---

## 策略3：PTB偏差

### 逻辑

比较**Binance现货**与**Chainlink PTB**（价格到价）。

1. **等待**直到期间的最后**60秒**
2. 如果`|Binance − PTB| > 阈值（$）`：
   - Binance**上方**PTB → 购买**是**（预期向上结算）
   - Binance**下方**PTB → 购买**否**（预期向下结算）
3. 仅在问价≤**0.99**时进入
4. **每个期间一个信号**

### 参数

| 字段 | 默认值 | 描述 |
|-------|---------|---------------------|
| 份额 | 5 | 订单大小 |
| 限制价格 | 0.99 | 最高问价进入 |
| 阈值（$） | 资产+TF特定 | USD最小偏差 |
| 信号窗口（秒） | 60 | 仅扫描最后N秒 |

### 实时行为

- 使用来自收集器实时帧的`cl_ptb_deviation`
- 状态显示当前偏差vs所需阈值

### 回测

需要`spread/cl_ptb_deviation/{ASSET}_{tf}.jsonl`和问价/买价数据。

---

## 如何逐步运行回测

1. 至少运行收集器，以获取您想要测试的日期
2. 打开仪表板 → 选择**币种**和**时间框架**
3. 在策略面板顶部设置**开始**和**结束**日期（东部时间）
4. 选择策略选项卡 → 调整参数
5. 单击**回测**
6. 阅读摘要+结果表

如果您获得0笔交易，要么该范围内没有信号触发，要么这些日期的数据丢失。

---

## 如何逐步运行实时

1. 完成[02 — 首次运行](02-first-run.md) — 收集器+仪表板已连接
2. 对于**真实订单**，首先完成[05 — 实时交易](05-live-trading.md)
3. 选择币种+时间框架
4. 选择策略 → 单击**实时交易**
5. 观看实时面板+**实时交易历史**表
6. 单击**停止实时**结束运行器

**重要：** 停止实时**不会**取消Polymarket上的未结订单。45¢双重GTD订单在期间结束时自动过期。

---

## 运行多个策略

您可以同时运行**每个（策略、资产、时间框架）一个实时运行器**：

- BTC 5m上的45¢双重
- BTC 5m上的90¢动量
- ETH 5m上的PTB

BTC 5m上的所有三个同时支持，但使用更多资本和API负载。

---

## 下一步

在**[05 — 实时交易](05-live-trading.md)**中设置真实订单。
