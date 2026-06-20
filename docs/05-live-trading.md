# 05 — Live trading

[English](#english) | [中文](#中文)

## English

This guide enables **real Polymarket CLOB orders** from PolyPulse. Read fully before setting `LIVE_TRADING_ENABLED=true`.

---

## Paper vs live

| Mode | `LIVE_TRADING_ENABLED` | Behavior |
|------|------------------------|----------|
| **Paper** | `false` | Signals fire, history shows `PAPER`, **no orders sent** |
| **Live** | `true` + valid wallet | Real limit orders on Polymarket |

**Always start in paper mode** until you understand signals and timing.

---

## Step 1: Polymarket account requirements

You need:

1. A Polymarket account with a **deposit wallet** (proxy address on Polygon)
2. **USDC balance** on that wallet for buys (Polymarket uses USDC collateral)
3. The **private key** that signs for your account (export from your wallet setup — never share it)

Find your **proxy wallet address** on Polymarket profile / settings (starts with `0x…`).

---

## Step 2: Choose signature type

Set `POLYMARKET_SIGNATURE_TYPE` in `.env`:

| Value | Account type |
|-------|----------------|
| `0` | EOA — direct wallet, no proxy |
| `1` | Email / Magic link proxy |
| `2` | Browser wallet / Gnosis Safe (most common) |
| `3` | POLY_1271 smart contract wallet |

Most browser Polymarket users: **`2`**  
If you use a Polymarket smart wallet: **`3`**

Wrong signature type → orders fail with authentication or maker-address errors.

---

## Step 3: Edit `.env`

```env
LIVE_TRADING_ENABLED=true

# Hex private key — with or without 0x prefix
POLYMARKET_PRIVATE_KEY=your_key_here

# Your Polymarket deposit / proxy wallet (required for types 1–3)
POLYMARKET_PROXY_WALLET=0xYourProxyAddress

POLYMARKET_SIGNATURE_TYPE=2
POLYMARKET_CHAIN_ID=137
```

**Security:**

- Never commit `.env` to git
- Never paste private keys in chat or screenshots
- Use a dedicated trading wallet with limited funds

---

## Step 4: Restart PolyPulse

Config is loaded at startup:

```bash
# Ctrl+C to stop, then:
npm run dev
```

---

## Step 5: Verify executor is ready

```bash
curl -s http://localhost:3003/api/trading/status
```

Good response:

```json
{
  "enabled": true,
  "mode": "live",
  "configured": true,
  "has_private_key": true,
  "has_proxy_wallet": true,
  "executor": {
    "ready": true,
    "clobVersion": 2,
    "sdk": "@polymarket/clob-client-v2"
  }
}
```

| Field | Problem if wrong |
|-------|------------------|
| `executor.ready: false` | Check `initError` — bad key, wrong sig type |
| `mode: "paper"` | `LIVE_TRADING_ENABLED` not true or missing key |
| `clobVersion` not `2` | Restart after code update; rebuild with `npm run build` |

---

## Step 6: Start a live strategy

1. Open http://localhost:3003
2. Select coin + timeframe
3. Open strategy tab (e.g. **45c Dual**)
4. Set shares / limit price
5. Click **Live trading**
6. Badge turns **LIVE**; status updates every ~200 ms

---

## Step 7: Read signals and history

### Live panel (per strategy)

Shows recent events, e.g.:

```
LIVE open dual — UP+DOWN limit BUY @ 0.45 × 5 (GTD 280s) [UP abc…] [DOWN def…]
```

Errors appear as `[order err: …]` or `[UP err: …]`.

### Live trading history table

Bottom of strategy column — all order attempts for current coin/TF:

| Status | Meaning |
|--------|---------|
| **OK** | Order accepted, ID shown |
| **ERR** | Rejected — hover for message |
| **PAPER** | Paper mode only |

Persistent log: `data/live_trades.jsonl`

---

## What each strategy sends live

| Strategy | Order type | When |
|----------|------------|------|
| 45c Dual | 2× GTD limit buys @ limit price | Period open |
| 90c Momentum | 1× GTC limit buy @ ask | Momentum signal in last 3 min |
| PTB Deviation | 1× GTC limit buy @ ask | PTB signal in last 60 s |

---

## Common order errors

| Error | Fix |
|-------|-----|
| `invalid order version` | Rebuild + restart — need CLOB v2 client |
| `not enough balance` / allowance | Deposit USDC to proxy wallet on Polymarket |
| `maker address not allowed` | Wrong `POLYMARKET_SIGNATURE_TYPE` or proxy address |
| `paper mode` | Set `LIVE_TRADING_ENABLED=true` and restart |
| `token id not resolved` | Wait for collector + market discovery (~30 s after period roll) |

More: [08 — Troubleshooting](08-troubleshooting.md)

---

## Step 8: Stop live trading

Click **Stop live** on the strategy card.

This stops the **runner** only. Open orders on Polymarket remain until filled, expired (GTD), or cancelled manually on Polymarket.

---

## Recommended rollout

1. **Day 1:** Paper mode, watch signals for 45c Dual on BTC 5m
2. **Day 2:** Live with **minimum shares (1–5)** on one strategy
3. **Day 3+:** Scale shares after confirming fills and history

---

## Next step

Full variable list: **[06 — Configuration](06-configuration.md)**

---

## 中文

本指南从PolyPulse启用**真实Polymarket CLOB订单**。在设置`LIVE_TRADING_ENABLED=true`之前完整阅读。

---

## 纸质vs实时

| 模式 | `LIVE_TRADING_ENABLED` | 行为 |
|------|------------------------|----------|
| **纸质** | `false` | 信号触发，历史显示`纸质`，**不发送订单** |
| **实时** | `true` +有效钱包 | Polymarket上的真实限制订单 |

**始终以纸质模式开始**，直到您理解信号和时间。

---

## 第1步：Polymarket账户要求

您需要：

1. 具有**存款钱包**的Polymarket账户（Polygon上的代理地址）
2. 该钱包上的**USDC余额**用于购买（Polymarket使用USDC抵押品）
3. **私钥**为您的账户签名（从钱包设置导出—从不共享）

在Polymarket个人资料/设置中找到您的**代理钱包地址**（以`0x…`开头）。

---

## 第2步：选择签名类型

在`.env`中设置`POLYMARKET_SIGNATURE_TYPE`：

| 值 | 账户类型 |
|-------|----------|
| `0` | EOA—直接钱包，无代理 |
| `1` | 电子邮件/魔术链接代理 |
| `2` | 浏览器钱包/Gnosis Safe（最常见） |
| `3` | POLY_1271智能合约钱包 |

最多浏览器Polymarket用户：**`2`**
如果您使用Polymarket智能钱包：**`3`**

错误的签名类型→订单因身份验证或制造商地址错误而失败。

---

## 第3步：编辑`.env`

```env
LIVE_TRADING_ENABLED=true

# 十六进制私钥—带或不带0x前缀
POLYMARKET_PRIVATE_KEY=your_key_here

# 您的Polymarket存款/代理钱包（类型1–3必需）
POLYMARKET_PROXY_WALLET=0xYourProxyAddress

POLYMARKET_SIGNATURE_TYPE=2
POLYMARKET_CHAIN_ID=137
```

**安全性：**

- 永不将`.env`提交到git
- 永不在聊天或屏幕截图中粘贴私钥
- 使用专用交易钱包，资金有限

---

## 第4步：重启PolyPulse

配置在启动时加载：

```bash
# Ctrl+C停止，然后：
npm run dev
```

---

## 第5步：验证执行器已准备就绪

```bash
curl -s http://localhost:3003/api/trading/status
```

良好响应：

```json
{
  "enabled": true,
  "mode": "live",
  "configured": true,
  "has_private_key": true,
  "has_proxy_wallet": true,
  "executor": {
    "ready": true,
    "clobVersion": 2,
    "sdk": "@polymarket/clob-client-v2"
  }
}
```

| 字段 | 如果错误的问题 |
|-------|----------|
| `executor.ready: false` | 检查`initError`—坏键，错误的签名类型 |
| `mode: "paper"` | `LIVE_TRADING_ENABLED`未真或缺少密钥 |
| `clobVersion`不`2` | 代码更新后重启；使用`npm run build`重建 |

---

## 第6步：启动实时策略

1. 打开http://localhost:3003
2. 选择币种+时间框架
3. 打开策略选项卡（例如**45¢双重**）
4. 设置份额/限制价格
5. 单击**实时交易**
6. 徽章变为**实时**；状态每~200毫秒更新一次

---

## 第7步：阅读信号和历史

### 实时面板（每个策略）

显示最近的事件，例如：

```
实时打开双重—UP+DOWN限制BUY @ 0.45 × 5（GTD 280s）[UP abc…][DOWN def…]
```

错误显示为`[order err: …]`或`[UP err: …]`。

### 实时交易历史表

策略列的底部—当前币种/TF的所有订单尝试：

| 状态 | 含义 |
|--------|------|
| **OK** | 订单已接受，显示ID |
| **ERR** | 被拒绝—悬停以查看消息 |
| **PAPER** | 仅纸质模式 |

持久日志：`data/live_trades.jsonl`

---

## 每个策略发送的实时

| 策略 | 订单类型 | 何时 |
|----------|------------|------|
| 45¢双重 | 2×GTD限制买入@限制价 | 期间打开 |
| 90¢动量 | 1×GTC限制买入@问价 | 最后3分钟的动量信号 |
| PTB偏差 | 1×GTC限制买入@问价 | 最后60秒的PTB信号 |

---

## 常见订单错误

| 错误 | 修复 |
|-------|------|
| `invalid order version` | 重建+重启—需要CLOB v2客户端 |
| `not enough balance` /余量 | 在Polymarket上将USDC存入代理钱包 |
| `maker address not allowed` | 错误的`POLYMARKET_SIGNATURE_TYPE`或代理地址 |
| `paper mode` | 设置`LIVE_TRADING_ENABLED=true`并重启 |
| `token id not resolved` | 等待收集器+市场发现（~30秒后期间滚动） |

更多：[08 — 故障排除](08-troubleshooting.md)

---

## 第8步：停止实时交易

单击策略卡上的**停止实时**。

这只是停止**运行器**。Polymarket上的未结订单保持不变，直到填充、过期（GTD）或在Polymarket上手动取消。

---

## 推荐推出

1. **第1天：** 纸质模式，观察BTC 5m上45¢双重的信号
2. **第2天：** 实时与**最少份额（1–5）** 一个策略上
3. **第3天+：** 在确认填充和历史后缩放份额

---

## 下一步

完整变量列表：**[06 — 配置](06-configuration.md)**
