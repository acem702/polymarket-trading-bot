# 03 — Dashboard guide

[English](#english) | [中文](#中文)

## English

PolyPulse dashboard layout: **left** = prices, **middle** = YES/NO asks, **right** = strategies + live trading history.

---

## Header bar

| Control | What it does |
|---------|----------------|
| **PolyPulse** | App title |
| **Coin buttons** | BTC, ETH, XRP, SOL, BNB, HYPE, DOGE — switches all panels |
| **Timeframe** | 5min / 15min / 1hour |
| **Status dot** | Green = collector connected; red = no live data |
| **Eastern clock** | US Eastern time (Polymarket market hours reference) |

Changing coin or timeframe reloads charts, strategy context, and live trading history filter.

---

## Left column — Price charts

### Binance spot + Chainlink PTB

- **Solid line:** Binance aggTrade price
- **Dashed line:** Chainlink price-to-beat (PTB) for the selected market period

PTB is the reference price Polymarket uses to settle up/down.

### Slug picker (below charts)

Lets you view **historical** periods instead of the current live one.

1. **Date** — pick a calendar day (Eastern)
2. **Slug dropdown** — list of collected markets for that day
3. **Go live** — jump back to the current rolling period

Use this to replay old 5m/15m/1h windows after the collector has been running for a while.

---

## Middle column — YES / NO asks

Two lines on one chart:

- **YES (UP)** — best ask to buy the up outcome
- **NO (DOWN)** — best ask to buy the down outcome

Prices are in dollars (0.00–1.00). A YES at 0.45 means the market implies ~45% chance of up.

This chart updates in real time when the collector is connected.

---

## Right column — Strategies

### Strategy tabs

| Tab | Strategy |
|-----|----------|
| **45c Dual** | Open limit UP + DOWN at 45¢ each period |
| **90c Momentum** | Binance momentum spike in last 3 min |
| **PTB Deviation** | Binance vs PTB deviation in last 60 s |

Only one strategy card is visible at a time; tabs switch the active card.

### Shared date range (backtest)

**Start (ET)** and **End (ET)** at the top apply to **Backtest** runs. Pick the days you have collected data for.

### Per-strategy fields

Each card has inputs (shares, limit price, thresholds, windows). Values are sent when you click **Backtest** or **Live trading**.

### Backtest button

Runs the strategy on historical JSONL in `./data/` for the selected coin, timeframe, and date range.

Results show:

- Summary stats (markets, trades, win %, PnL)
- Per-market result table

**Note:** Backtest needs data. Run the collector for at least one full day before backtesting that day.

### Live trading button

Starts or stops a **live runner** for this strategy + current coin + timeframe.

| State | Button label | Badge |
|-------|--------------|-------|
| Off | Live trading | OFF |
| Running | Stop live | LIVE |

Live panel shows:

- Status message (what the bot is doing now)
- Recent signals (last few events)
- Mode: paper or live (real orders)

Details: [04 — Strategies](04-strategies.md) and [05 — Live trading](05-live-trading.md).

---

## Live trading history table

At the bottom of the strategy column:

| Column | Meaning |
|--------|---------|
| Time | When the order was attempted |
| Strategy | Which strategy placed it |
| Side | UP (yes) or DOWN (no) |
| Price | Limit price |
| Shares | Size |
| Order | Polymarket order ID (if successful) |
| Status | OK / ERR / PAPER |

Filtered by **current coin + timeframe**. Updates every 2 seconds while dashboard is open.

History is also saved to `data/live_trades.jsonl` (survives restarts).

---

## WebSocket (advanced)

The dashboard uses `GET /ws` for live frame updates (~5 Hz). You normally do not need this unless building custom tools.

---

## Next step

Understand each strategy in **[04 — Strategies](04-strategies.md)**.

---

## 中文

PolyPulse仪表板布局：**左**=价格，**中**=是/否报价，**右**=策略+实时交易历史。

---

## 标题栏

| 控制项 | 功能 |
|---------|-------|
| **PolyPulse** | 应用标题 |
| **币种按钮** | BTC、ETH、XRP、SOL、BNB、HYPE、DOGE — 切换所有面板 |
| **时间框架** | 5分钟 / 15分钟 / 1小时 |
| **状态指示灯** | 绿色=收集器已连接；红色=无实时数据 |
| **东部时钟** | 美国东部时间（Polymarket市场时间参考） |

更改币种或时间框架会重新加载图表、策略上下文和实时交易历史过滤器。

---

## 左列 — 价格图表

### Binance现货 + Chainlink PTB

- **实线：** Binance aggTrade价格
- **虚线：** Chainlink价格到价（PTB）用于所选市场期间

PTB是Polymarket用于结算上/下的参考价格。

### Slug选择器（图表下方）

允许您查看**历史**期间而不是当前实时期间。

1. **日期** — 选择一个日历日（东部时间）
2. **Slug下拉菜单** — 该日期收集的市场列表
3. **开始直播** — 跳回当前滚动期间

在收集器运行一段时间后，使用此功能重新回放旧的5m/15m/1h窗口。

---

## 中列 — 是/否报价

一个图表上的两条线：

- **是（向上）** — 购买上升结果的最佳报价
- **否（向下）** — 购买下降结果的最佳报价

价格以美元计（0.00–1.00）。是价格为0.45意味着市场隐含的向上概率约为45%。

当收集器连接时，此图表实时更新。

---

## 右列 — 策略

### 策略选项卡

| 选项卡 | 策略 |
|--------|------|
| **45¢双重** | 每期在45¢开放限制上+下 |
| **90¢动量** | Binance最后3分钟的动量尖峰 |
| **PTB偏差** | Binance vs PTB最后60秒偏差 |

一次只能看到一个策略卡；选项卡切换活动卡。

### 共享日期范围（回测）

顶部的**开始（ET）**和**结束（ET）**适用于**回测**运行。选择您收集数据的日期。

### 每个策略字段

每个卡都有输入（份额、限制价格、阈值、时间窗口）。当您单击**回测**或**实时交易**时，值被发送。

### 回测按钮

在`./data/`中对所选币种、时间框架和日期范围的历史JSONL运行策略。

结果显示：

- 摘要统计（市场、交易、胜率%、损益）
- 每市场结果表

**注意：** 回测需要数据。在对该天进行回测之前，至少运行收集器一整天。

### 实时交易按钮

启动或停止此策略+当前币种+时间框架的**实时运行器**。

| 状态 | 按钮标签 | 徽章 |
|--------|-----------|------|
| 关闭 | 实时交易 | 关闭 |
| 运行中 | 停止实时 | 直播 |

实时面板显示：

- 状态消息（机器人现在在做什么）
- 最近信号（最后几个事件）
- 模式：纸张或实时（真实订单）

详情：[04 — 策略](04-strategies.md)和[05 — 实时交易](05-live-trading.md)。

---

## 实时交易历史表

在策略列的底部：

| 列 | 含义 |
|-----|------|
| 时间 | 尝试订单的时间 |
| 策略 | 哪个策略下达订单 |
| 边 | 上升（是）或下降（否） |
| 价格 | 限制价格 |
| 份额 | 大小 |
| 订单 | Polymarket订单ID（如果成功） |
| 状态 | OK / ERR / PAPER |

按**当前币种+时间框架**过滤。仪表板打开时每2秒更新一次。

历史也保存到`data/live_trades.jsonl`（重启后保留）。

---

## WebSocket（高级）

仪表板使用`GET /ws`进行实时帧更新（~5 Hz）。通常除非您构建自定义工具，否则无需使用此功能。

---

## 下一步

在**[04 — 策略](04-strategies.md)**中了解每个策略。
