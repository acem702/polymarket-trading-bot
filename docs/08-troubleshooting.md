# 08 — Troubleshooting

[English](#english) | [中文](#中文)

## English

Common problems and fixes for PolyPulse.

---

## Dashboard shows red “connecting…”

**Cause:** Dashboard cannot read live frames from collector.

**Fix checklist:**

1. Is collector running? Look for `PolyPulse collector starting` in terminal
2. Same `IPC_PATH` in `.env` for both processes?
3. Restart both:
   ```bash
   npm run dev
   ```
4. Check socket exists:
   ```bash
   ls -la /tmp/polypulse.sock
   ```
5. Old socket from crashed process:
   ```bash
   rm -f /tmp/polypulse.sock
   npm run dev
   ```

---

## Port 3003 already in use

**Error:** `EADDRINUSE 0.0.0.0:3003`

**Fix:**

```bash
# Find process
lsof -i :3003

# Kill it, or change port in .env:
DASHBOARD_BIND=0.0.0.0:3004
```

Restart and open http://localhost:3004

---

## npm run build fails

**TypeScript errors:**

```bash
npm run build -w @pmt/shared
npm run build -w @pmt/strategies
npm run build -w @pmt/collector
npm run build -w @pmt/dashboard
```

Fix the package that fails first. Often fixed by:

```bash
rm -rf node_modules packages/*/dist
npm install
npm run build
```

---

## Backtest returns 0 trades

**Causes:**

| Cause | Fix |
|-------|-----|
| No data for date range | Run collector during those dates |
| Wrong coin/timeframe | Match backtest to collected data |
| Threshold too high | Lower momentum/PTB threshold |
| Limit price too low | Asks never reached your limit |

Check data exists:

```bash
ls data/market_data/5min/BTC/
ls data/ask_bid_prices/5min/BTC/ | head
```

---

## Live trading: paper mode only

**Symptoms:** History shows `PAPER`, no real order IDs.

**Fix:**

1. Set `LIVE_TRADING_ENABLED=true` in `.env`
2. Set `POLYMARKET_PRIVATE_KEY` and `POLYMARKET_PROXY_WALLET`
3. Restart: `npm run dev`
4. Verify:
   ```bash
   curl -s http://localhost:3003/api/trading/status
   ```
   Expect `"mode":"live"` and `"executor":{"ready":true}`

---

## Live trading: order errors

### `invalid order version, please use the latest clob-client`

Old CLOB client in memory. Fix:

```bash
npm run build -w @pmt/dashboard
# Stop and restart npm run dev completely
```

Status should show `"clobVersion":2`.

### Balance / allowance errors

Deposit **USDC** to your Polymarket proxy wallet. Approve trading on Polymarket website if needed.

### Signature / maker address errors

Try different `POLYMARKET_SIGNATURE_TYPE`:

- Browser wallet users → `2`
- Smart contract wallet → `3`

Confirm `POLYMARKET_PROXY_WALLET` matches Polymarket profile address.

### `token id not resolved`

Market discovery still loading. Wait 30–60 s after period roll or after starting live runner.

---

## 45c Dual: orders not placed at open

**Checklist:**

1. Live runner started **before** or shortly after period open?
2. `executor.ready` true?
3. Live panel status — `waiting for market tokens` vs `placing UP+DOWN`?
4. History table for ERR messages

Restart live runner: **Stop live** → **Live trading**

---

## Momentum / PTB: no signal all period

**Normal** if conditions not met:

- Momentum: Binance move below threshold in last 3 min
- PTB: deviation below threshold in last 60 s
- Ask above limit price (0.90 / 0.99)

Watch status line in live panel for current values.

---

## Duplicate collector processes

Two collectors fighting over one socket causes flaky data.

```bash
ps aux | grep polypulse
ps aux | grep collector
```

Kill extras, keep one `npm run dev`.

---

## Logs

| Source | Location |
|--------|----------|
| Dev terminal | stdout from `[collector]` / `[dashboard]` |
| PM2 | `./logs/collector.log`, `./logs/dashboard.log` |
| Live trades | `data/live_trades.jsonl` |

Increase log detail:

```bash
LOG_LEVEL=debug npm run collector
```

---

## Still stuck?

Gather this info:

1. Output of `curl http://localhost:3003/api/trading/status`
2. Last 30 lines of collector + dashboard logs
3. Strategy, asset, timeframe, and `.env` ( **redact private key** )
4. Screenshot or text of live panel status + history ERR row

---

## 中文

PolyPulse的常见问题和修复。

---

## 仪表板显示红色"连接中…"

**原因：** 仪表板无法从收集器读取实时帧。

**修复检查清单：**

1. 收集器正在运行吗？在终端中查找`PolyPulse collector starting`
2. 两个流程的`.env`中的`IPC_PATH`相同？
3. 重启两者：
   ```bash
   npm run dev
   ```
4. 检查套接字是否存在：
   ```bash
   ls -la /tmp/polypulse.sock
   ```
5. 来自崩溃流程的旧套接字：
   ```bash
   rm -f /tmp/polypulse.sock
   npm run dev
   ```

---

## 端口3003已在使用

**错误：** `EADDRINUSE 0.0.0.0:3003`

**修复：**

```bash
# 查找流程
lsof -i :3003

# 杀死它，或在.env中更改端口：
DASHBOARD_BIND=0.0.0.0:3004
```

重启并打开http://localhost:3004

---

## npm run build失败

**TypeScript错误：**

```bash
npm run build -w @pmt/shared
npm run build -w @pmt/strategies
npm run build -w @pmt/collector
npm run build -w @pmt/dashboard
```

首先修复失败的包。通常通过以下方式修复：

```bash
rm -rf node_modules packages/*/dist
npm install
npm run build
```

---

## 回测返回0笔交易

**原因：**

| 原因 | 修复 |
|-------|------|
| 日期范围没有数据 | 在这些日期运行收集器 |
| 错误的币种/时间框架 | 匹配回测到收集的数据 |
| 阈值太高 | 降低动量/PTB阈值 |
| 限制价格太低 | 问价从未达到您的限制 |

检查数据是否存在：

```bash
ls data/market_data/5min/BTC/
ls data/ask_bid_prices/5min/BTC/ | head
```

---

## 实时交易：仅纸质模式

**症状：** 历史显示`纸质`，无真实订单ID。

**修复：**

1. 在`.env`中设置`LIVE_TRADING_ENABLED=true`
2. 设置`POLYMARKET_PRIVATE_KEY`和`POLYMARKET_PROXY_WALLET`
3. 重启：`npm run dev`
4. 验证：
   ```bash
   curl -s http://localhost:3003/api/trading/status
   ```
   期望`"mode":"live"`和`"executor":{"ready":true}`

---

## 实时交易：订单错误

### `invalid order version, please use the latest clob-client`

内存中的旧CLOB客户端。修复：

```bash
npm run build -w @pmt/dashboard
# 完全停止并重启npm run dev
```

状态应显示`"clobVersion":2`。

### 余额/允许错误

将**USDC**存入您的Polymarket代理钱包。如需要，在Polymarket网站上批准交易。

### 签名/制造商地址错误

尝试不同的`POLYMARKET_SIGNATURE_TYPE`：

- 浏览器钱包用户 → `2`
- 智能合约钱包 → `3`

确认`POLYMARKET_PROXY_WALLET`与Polymarket个人资料地址匹配。

### `token id not resolved`

市场发现仍在加载。在期间滚动后或启动实时运行器后等待30–60秒。

---

## 45¢双重：订单未在打开时下达

**检查清单：**

1. 实时运行器在期间打开时**之前**或**之后**不久启动？
2. `executor.ready`为真？
3. 实时面板状态—`等待市场令牌`vs`下达UP+DOWN`？
4. 历史表中的ERR消息

重启实时运行器：**停止实时** → **实时交易**

---

## 动量/PTB：整个期间无信号

如果条件未满足，这是**正常**的：

- 动量：Binance最后3分钟的移动低于阈值
- PTB：最后60秒的偏差低于阈值
- 问价高于限制价格（0.90 / 0.99）

监视实时面板中的状态行以获取当前值。

---

## 重复收集器流程

两个收集器争夺一个套接字导致不稳定的数据。

```bash
ps aux | grep polypulse
ps aux | grep collector
```

杀死额外的，保持一个`npm run dev`。

---

## 日志

| 来源 | 位置 |
|--------|----------|
| 开发终端 | `[collector]`/`[dashboard]`的stdout |
| PM2 | `./logs/collector.log`，`./logs/dashboard.log` |
| 实时交易 | `data/live_trades.jsonl` |

增加日志详细程度：

```bash
LOG_LEVEL=debug npm run collector
```

---

## 仍然困顿？

收集此信息：

1. `curl http://localhost:3003/api/trading/status`的输出
2. 收集器+仪表板日志的最后30行
3. 策略、资产、时间框架和`.env`（**编辑私钥**）
4. 实时面板状态+历史ERR行的屏幕截图或文本
