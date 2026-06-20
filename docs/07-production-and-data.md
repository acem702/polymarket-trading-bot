# 07 — Production & data

[English](#english) | [中文](#中文)

## English

How to run PolyPulse 24/7, where data is stored, and available HTTP APIs.

---

## Production with PM2

[PM2](https://pm2.keymetrics.io/) keeps collector and dashboard running after you disconnect from SSH.

### Step 1: Install PM2

```bash
npm install -g pm2
```

### Step 2: Build production JavaScript

```bash
cd polymarket-multi-tool-ts
npm run build
```

### Step 3: Start apps

```bash
pm2 start ecosystem.config.js
```

This starts:

| PM2 name | Process |
|----------|---------|
| `polypulse-collector` | `packages/collector/dist/main.js` |
| `polypulse-dashboard` | `packages/dashboard/dist/main.js` |

Logs: `./logs/collector.log`, `./logs/dashboard.log`

### Step 4: Useful PM2 commands

```bash
pm2 status              # list processes
pm2 logs                # tail all logs
pm2 logs polypulse-collector
pm2 restart all         # after .env change
pm2 stop all
pm2 save                # save process list
pm2 startup             # auto-start on boot (follow printed command)
```

After editing `.env`:

```bash
pm2 restart all
```

---

## Data directory layout

All paths relative to `DATA_DIR` (default `./data`).

```
data/
├── prices/
│   ├── binance/BTC.jsonl          # Binance tick prices
│   └── chainlink/BTC.jsonl        # Chainlink RTDS
├── order_books/
│   └── 5min/BTC/{slug}.jsonl      # Full CLOB book snapshots
├── ask_bid_prices/
│   └── 5min/BTC/{slug}.jsonl      # YES/NO best bid/ask over time
├── market_data/
│   └── 5min/BTC/5m.jsonl          # Period settlements (up/down)
├── spread/
│   ├── binance_chainlink/BTC.jsonl
│   ├── cl_ptb_deviation/BTC_5m.jsonl
│   └── latest.json
├── live_trades.jsonl              # Live order history (append-only)
└── ...
```

Timeframe folders: `5min`, `15min`, `1hour`.

### Disk usage

5m markets on 7 assets generate significant JSONL over days. Monitor disk:

```bash
du -sh data/
```

Archive or delete old `order_books/` if space is tight (backtests for old dates will break for deleted slugs).

---

## HTTP API reference

Base URL: `http://localhost:3003` (or your `DASHBOARD_BIND`).

### Live / UI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard HTML |
| GET | `/ws` | WebSocket live frames |

### Market data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/markets` | Current markets snapshot |
| GET | `/api/prices` | Latest spot prices |
| GET | `/api/history/:asset/:venue` | Price history (`Binance`, `Chainlink`) |
| GET | `/api/spread/:asset` | Binance−Chainlink spread history |
| GET | `/api/spread/latest` | Latest spread snapshot |
| GET | `/api/slugs/:asset/:tf` | List collected slugs (`?date=YYYY-MM-DD`) |
| GET | `/api/ask_bid_history/:asset/:tf` | Ask/bid history for current slug |
| GET | `/api/orderbook/:asset/:tf/:slug` | Order book snapshot |
| GET | `/api/ptb/:asset/:tf` | PTB for slug query param |

### Strategies

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/strategies` | Default parameters |
| POST | `/api/strategies/run` | Run backtest (JSON body) |
| GET | `/api/strategies/live` | All active live runners |
| POST | `/api/strategies/live/start` | Start live runner |
| POST | `/api/strategies/live/stop` | Stop live runner |
| GET | `/api/strategies/live/history` | Trade history (`?asset=&tf=&limit=`) |

### Trading

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trading/status` | Live/paper mode + CLOB client status |

### Example: backtest via curl

```bash
curl -s -X POST http://localhost:3003/api/strategies/run \
  -H 'Content-Type: application/json' \
  -d '{
    "strategy": "dual_45c",
    "asset": "BTC",
    "tf": "5m",
    "start_date": "2026-06-18",
    "end_date": "2026-06-19",
    "shares": 5,
    "limit_price": 0.45
  }'
```

---

## Architecture (simple)

```
┌─────────────┐     Unix socket      ┌─────────────┐
│  Collector  │ ─── IPC_PATH ──────► │  Dashboard  │
│  (feeds)    │                      │  (UI + API) │
└──────┬──────┘                      └──────┬──────┘
       │                                      │
       ▼                                      ▼
   ./data/*.jsonl                      Browser :3003
                                            │
                                            ▼
                                    Polymarket CLOB
                                    (live orders only)
```

---

## Next step

Problems? **[08 — Troubleshooting](08-troubleshooting.md)**

---

## 中文

如何24/7运行PolyPulse、数据存储位置以及可用的HTTP API。

---

## PM2生产

[PM2](https://pm2.keymetrics.io/)在您断开SSH连接后保持收集器和仪表板运行。

### 第1步：安装PM2

```bash
npm install -g pm2
```

### 第2步：构建生产JavaScript

```bash
cd polymarket-multi-tool-ts
npm run build
```

### 第3步：启动应用

```bash
pm2 start ecosystem.config.js
```

这启动：

| PM2名称 | 流程 |
|----------|----------|
| `polypulse-collector` | `packages/collector/dist/main.js` |
| `polypulse-dashboard` | `packages/dashboard/dist/main.js` |

日志：`./logs/collector.log`，`./logs/dashboard.log`

### 第4步：有用的PM2命令

```bash
pm2 status              # 列出流程
pm2 logs                # 尾部所有日志
pm2 logs polypulse-collector
pm2 restart all         # .env更改后
pm2 stop all
pm2 save                # 保存流程列表
pm2 startup             # 引导时自动启动（遵循打印命令）
```

编辑`.env`后：

```bash
pm2 restart all
```

---

## 数据目录布局

所有路径相对于`DATA_DIR`（默认`./data`）。

```
data/
├── prices/
│   ├── binance/BTC.jsonl          # Binance刻度价格
│   └── chainlink/BTC.jsonl        # Chainlink RTDS
├── order_books/
│   └── 5min/BTC/{slug}.jsonl      # 完整CLOB书快照
├── ask_bid_prices/
│   └── 5min/BTC/{slug}.jsonl      # YES/NO最佳竞价/报价
├── market_data/
│   └── 5min/BTC/5m.jsonl          # 期间结算（上/下）
├── spread/
│   ├── binance_chainlink/BTC.jsonl
│   ├── cl_ptb_deviation/BTC_5m.jsonl
│   └── latest.json
├── live_trades.jsonl              # 实时订单历史（仅追加）
└── ...
```

时间框架文件夹：`5min`、`15min`、`1hour`。

### 磁盘使用

7个资产上的5m市场在几天内生成大量JSONL。监视磁盘：

```bash
du -sh data/
```

如果空间紧张，归档或删除旧`order_books/`（旧日期的回测将因删除的slug而中断）。

---

## HTTP API参考

基本URL：`http://localhost:3003`（或您的`DASHBOARD_BIND`）。

### 实时/UI

| 方法 | 路径 | 描述 |
|--------|------|---------|
| GET | `/` | 仪表板HTML |
| GET | `/ws` | WebSocket实时帧 |

### 市场数据

| 方法 | 路径 | 描述 |
|--------|------|---------|
| GET | `/api/markets` | 当前市场快照 |
| GET | `/api/prices` | 最新现货价格 |
| GET | `/api/history/:asset/:venue` | 价格历史（`Binance`，`Chainlink`） |
| GET | `/api/spread/:asset` | Binance−Chainlink价差历史 |
| GET | `/api/spread/latest` | 最新价差快照 |
| GET | `/api/slugs/:asset/:tf` | 列出收集的slug（`?date=YYYY-MM-DD`） |
| GET | `/api/ask_bid_history/:asset/:tf` | 当前slug的问价/买价历史 |
| GET | `/api/orderbook/:asset/:tf/:slug` | 订单簿快照 |
| GET | `/api/ptb/:asset/:tf` | slug查询参数的PTB |

### 策略

| 方法 | 路径 | 描述 |
|--------|------|---------|
| GET | `/api/strategies` | 默认参数 |
| POST | `/api/strategies/run` | 运行回测（JSON正文） |
| GET | `/api/strategies/live` | 所有活跃实时运行器 |
| POST | `/api/strategies/live/start` | 启动实时运行器 |
| POST | `/api/strategies/live/stop` | 停止实时运行器 |
| GET | `/api/strategies/live/history` | 交易历史（`?asset=&tf=&limit=`） |

### 交易

| 方法 | 路径 | 描述 |
|--------|------|---------|
| GET | `/api/trading/status` | 实时/纸质模式+CLOB客户端状态 |

### 示例：通过curl回测

```bash
curl -s -X POST http://localhost:3003/api/strategies/run \
  -H 'Content-Type: application/json' \
  -d '{
    "strategy": "dual_45c",
    "asset": "BTC",
    "tf": "5m",
    "start_date": "2026-06-18",
    "end_date": "2026-06-19",
    "shares": 5,
    "limit_price": 0.45
  }'
```

---

## 架构（简单）

```
┌─────────────┐     Unix套接字      ┌─────────────┐
│  收集器  │ ─── IPC_PATH ──────► │  仪表板  │
│  （馈送）    │                      │  （UI+API） │
└──────┬──────┘                      └──────┬──────┘
       │                                      │
       ▼                                      ▼
   ./data/*.jsonl                      浏览器:3003
                                            │
                                            ▼
                                    Polymarket CLOB
                                    （仅实时订单）
```

---

## 下一步

问题？**[08 — 故障排除](08-troubleshooting.md)**
