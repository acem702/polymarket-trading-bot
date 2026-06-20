# 06 — Configuration

[English](#english) | [中文](#中文)

## English

All settings live in **`.env`** at the project root. Copy from `.env.example` and edit.

Both collector and dashboard read the same file (default path: `.env` in project root).

Custom path:

```bash
npm run collector -- --env /path/to/my.env
npm run dashboard -- --env /path/to/my.env
```

---

## Collector feeds

| Variable | Default | Description |
|----------|---------|-------------|
| `BINANCE_WS_URL` | `wss://data-stream.binance.vision` | Binance aggTrade WebSocket |
| `CHAINLINK_WS_URL` | `wss://ws-live-data.polymarket.com` | Polymarket Chainlink RTDS |
| `GAMMA_URL` | `https://gamma-api.polymarket.com` | Market metadata API |
| `CLOB_URL` | `https://clob.polymarket.com` | Order book + order API |

Usually leave defaults unless Polymarket changes endpoints.

---

## Paths

| Variable | Default | Description |
|----------|---------|-------------|
| `IPC_PATH` | `/tmp/polypulse.sock` | Unix socket linking collector → dashboard |
| `DATA_DIR` | `./data` | All JSONL output and live trade history |

Collector and dashboard **must use the same** `IPC_PATH` and `DATA_DIR`.

---

## Dashboard

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_BIND` | `0.0.0.0:3003` | HTTP listen address |

Examples:

```env
DASHBOARD_BIND=127.0.0.1:3003    # localhost only
DASHBOARD_BIND=0.0.0.0:8080      # port 8080, all interfaces
```

---

## Strategy defaults

These apply to backtests and live runners when you do not override in the UI.

| Variable | Default | Used by |
|----------|---------|---------|
| `STRATEGY_SHARES` | `5` | All strategies |
| `DUAL_45C_LIMIT_PRICE` | `0.45` | 45c Dual |
| `MOMENTUM_90C_LIMIT_PRICE` | `0.90` | 90c Momentum |
| `MOMENTUM_90C_WINDOW_SECS` | `3` | Momentum lookback window |
| `MOMENTUM_90C_SIGNAL_TAIL_SECS` | `180` | Last N sec of period only |
| `PTB_DEVIATION_LIMIT_PRICE` | `0.99` | PTB Deviation max ask |
| `PTB_DEVIATION_SIGNAL_WINDOW_SECS` | `60` | Last N sec of period only |

---

## Live trading

| Variable | Default | Description |
|----------|---------|-------------|
| `LIVE_TRADING_ENABLED` | `false` in example | `true` = real CLOB orders |
| `POLYMARKET_PRIVATE_KEY` | (empty) | Signer private key hex |
| `POLYMARKET_PROXY_WALLET` | (empty) | Deposit wallet address |
| `POLYMARKET_SIGNATURE_TYPE` | `2` | 0–3, see [05 — Live trading](05-live-trading.md) |
| `POLYMARKET_CHAIN_ID` | `137` | Polygon mainnet |

---

## Example `.env` files

### Minimal (paper trading only)

```env
LIVE_TRADING_ENABLED=false
IPC_PATH=/tmp/polypulse.sock
DATA_DIR=./data
DASHBOARD_BIND=0.0.0.0:3003
```

### Live trading (fill in your values)

```env
LIVE_TRADING_ENABLED=true
POLYMARKET_PRIVATE_KEY=abc123...
POLYMARKET_PROXY_WALLET=0x1bbC...
POLYMARKET_SIGNATURE_TYPE=2
POLYMARKET_CHAIN_ID=137
```

---

## Changing config at runtime

PolyPulse does **not** hot-reload `.env`. After any change:

```bash
# Stop npm run dev (Ctrl+C), then:
npm run dev
```

Live runners in memory are cleared on restart — click **Live trading** again after restart.

---

## Next step

Run 24/7: **[07 — Production & data](07-production-and-data.md)**

---

## 中文

所有设置都在项目根的**`.env`**中。从`.env.example`复制并编辑。

收集器和仪表板读取同一文件（默认路径：项目根中的`.env`）。

自定义路径：

```bash
npm run collector -- --env /path/to/my.env
npm run dashboard -- --env /path/to/my.env
```

---

## 收集器馈送

| 变量 | 默认值 | 描述 |
|----------|---------|---------|
| `BINANCE_WS_URL` | `wss://data-stream.binance.vision` | Binance aggTrade WebSocket |
| `CHAINLINK_WS_URL` | `wss://ws-live-data.polymarket.com` | Polymarket Chainlink RTDS |
| `GAMMA_URL` | `https://gamma-api.polymarket.com` | 市场元数据API |
| `CLOB_URL` | `https://clob.polymarket.com` | 订单簿+订单API |

通常保留默认值，除非Polymarket更改端点。

---

## 路径

| 变量 | 默认值 | 描述 |
|----------|---------|---------|
| `IPC_PATH` | `/tmp/polypulse.sock` | Unix套接字链接收集器→仪表板 |
| `DATA_DIR` | `./data` | 所有JSONL输出和实时交易历史 |

收集器和仪表板**必须使用相同**的`IPC_PATH`和`DATA_DIR`。

---

## 仪表板

| 变量 | 默认值 | 描述 |
|----------|---------|---------|
| `DASHBOARD_BIND` | `0.0.0.0:3003` | HTTP监听地址 |

示例：

```env
DASHBOARD_BIND=127.0.0.1:3003    # 仅localhost
DASHBOARD_BIND=0.0.0.0:8080      # 端口8080，所有接口
```

---

## 策略默认值

这些适用于当您不在UI中覆盖时的回测和实时运行器。

| 变量 | 默认值 | 使用者 |
|----------|---------|---------|
| `STRATEGY_SHARES` | `5` | 所有策略 |
| `DUAL_45C_LIMIT_PRICE` | `0.45` | 45¢双重 |
| `MOMENTUM_90C_LIMIT_PRICE` | `0.90` | 90¢动量 |
| `MOMENTUM_90C_WINDOW_SECS` | `3` | 动量回顾窗口 |
| `MOMENTUM_90C_SIGNAL_TAIL_SECS` | `180` | 仅期间最后N秒 |
| `PTB_DEVIATION_LIMIT_PRICE` | `0.99` | PTB偏差最高问价 |
| `PTB_DEVIATION_SIGNAL_WINDOW_SECS` | `60` | 仅扫描最后N秒 |

---

## 实时交易

| 变量 | 默认值 | 描述 |
|----------|---------|---------|
| `LIVE_TRADING_ENABLED` | 示例中为`false` | `true` =真实CLOB订单 |
| `POLYMARKET_PRIVATE_KEY` | （空） | 签名者私钥十六进制 |
| `POLYMARKET_PROXY_WALLET` | （空） | 存款钱包地址 |
| `POLYMARKET_SIGNATURE_TYPE` | `2` | 0–3，参见[05 — 实时交易](05-live-trading.md) |
| `POLYMARKET_CHAIN_ID` | `137` | Polygon主网 |

---

## 示例`.env`文件

### 最小（仅纸质交易）

```env
LIVE_TRADING_ENABLED=false
IPC_PATH=/tmp/polypulse.sock
DATA_DIR=./data
DASHBOARD_BIND=0.0.0.0:3003
```

### 实时交易（填入您的值）

```env
LIVE_TRADING_ENABLED=true
POLYMARKET_PRIVATE_KEY=abc123...
POLYMARKET_PROXY_WALLET=0x1bbC...
POLYMARKET_SIGNATURE_TYPE=2
POLYMARKET_CHAIN_ID=137
```

---

## 运行时更改配置

PolyPulse**不** hot-reload`.env`。任何更改后：

```bash
# 停止npm run dev（Ctrl+C），然后：
npm run dev
```

内存中的实时运行器在重启时被清除—重启后再次单击**实时交易**。

---

## 下一步

24/7运行：**[07 — 生产与数据](07-production-and-data.md)**
