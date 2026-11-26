# ClaimProof Agent — Telegraph Hackathon Season II (Mission 15: Consumer Automation)

> **Autonomous flight-disruption refund agent** that buys verified disruption reports, fare refund rules, and live rebooking availability via **Telegraph Protocol x402** (Base Sepolia USDC), enforces hard per-claim spending caps, and outputs a ready-to-file refund claim packet with cryptographic payment receipts attached.

**Live 2-Minute Demo Video (1080p):** [Watch on YouTube — ClaimProof Agent Demo](https://youtu.be/2vrZ4oF3sQc)

---

## Why ClaimProof Exists (Commercial Summary)

1. **Who is it for?** Retail air travelers, travel-claim automation services, and consumer AI assistants handling flight delays or cancellations.
2. **What does it improve?** Airlines routinely reject informal refund requests and third-party claim agencies charge **25%–35%** of a passenger's compensation ($150–$210 on a $600 EU261 claim). ClaimProof autonomously buys independently verified disruption evidence, fare/statutory rules, and rebooking options for **$0.02–$0.03** total — under **0.005%** of the claim value.
3. **What does it do today?** Connects to Telegraph Protocol (`devnode.telegraphprotocol.com`), enforces a hard budget cap before spending, autonomously signs gasless EIP-3009 x402 payments in Base Sepolia Test USDC, purchases 2–3 specialized Telegraph Intents (`TRAVEL_DISRUPTION_GENERAL`, `FARE_RULE_VERIFY_GENERAL`, `FLIGHT_AVAILABILITY_GENERAL`), logs every payment to a local audit ledger (`data/ledger.json`), and generates a downloadable claim packet with cryptographic Base Sepolia transaction links.
4. **Why would someone adopt it?** Zero subscriptions, zero API key sprawl across flight/fare vendors, transparent per-claim cost accounting ($0.02–$0.03/claim), and verifiable cryptographic proof attached to every claim.
5. **How can someone try it?** Clone this repo, run 3 commands below (zero ETH gas required — only free Base Sepolia Test USDC from Circle's faucet), and run either the Web UI (`http://localhost:3456`) or the 1-line CLI.

---

## Telegraph Protocol Integration

| Step | Telegraph Intent | Cost (x402) | Purpose |
|---|---|---:|---|
| 1 | `TRAVEL_DISRUPTION_GENERAL` | `$0.01` | Verifies operational delay/cancellation & airport conditions |
| 2 | `FARE_RULE_VERIFY_GENERAL` | `$0.01` | Verifies EU261 / UK261 / US DOT & airline fare refund eligibility |
| 3 | `FLIGHT_AVAILABILITY_GENERAL` *(optional)* | `$0.01` | Checks live alternative rebooking seats & fare classes |

- **Settlement Network:** Base Sepolia (`eip155:84532`) via `@x402/fetch` + `@x402/evm` (`ExactEvmScheme`, EIP-3009 gasless signature)
- **Endpoint:** `POST https://devnode.telegraphprotocol.com/engine/v1/ask`
- **Hard Spending Cap:** Configured via `MAX_BUDGET_USD` (default `$0.05` / per-request UI override). If planned spend exceeds the cap, the agent refuses to sign any x402 payment and returns HTTP `402 BUDGET_CAP_EXCEEDED` with `$0.00` spent.

---

## Quick Start (Reproducible in 2 Minutes)

### Prerequisites
- **Node.js ≥ 20** (tested on Node v22)
- Free **Base Sepolia Test USDC** from [faucet.circle.com](https://faucet.circle.com/) (select **Base Sepolia** — no ETH gas is required because x402 uses gasless EIP-3009 authorizations).

### 1. Install & Generate a Throwaway Testnet Wallet
```bash
git clone https://github.com/AZERINVEST/claimproof-agent.git
cd claimproof-agent
npm install
npm run wallet:new
```
This prints your new throwaway Base Sepolia wallet address and saves the private key locally in `.env` (`chmod 600`, gitignored). **Never use a mainnet wallet key.**

### 2. Fund the Wallet with Free Test USDC
Paste the printed wallet address into [https://faucet.circle.com/](https://faucet.circle.com/) (Network: **Base Sepolia**, Token: **USDC**). You will receive 10–20 free test USDC — enough for 1,000+ Telegraph intelligence queries.

### 3. Run the Web UI or CLI
**Web UI:**
```bash
npm run dev
# Open http://localhost:3456
```
**CLI (1-command test):**
```bash
npm run claim -- --flight LH400 --airline Lufthansa --origin FRA --destination JFK --date 2026-11-25 --price 780 --ref XK94LM
```

---

## Testing Failure Cases (Safety & Accounting Verification)

1. **Budget Cap Enforcement (`$0.00` spent):**
   - In the Web UI, click **`Test Budget-Cap Failure`** (sets `Max Budget Cap = $0.01` while 3 intents require `$0.03`), or via CLI:
     ```bash
     npm run claim -- --flight LH400 --budget 0.01
     ```
   - Expected result: Agent refuses execution with `BUDGET_CAP_EXCEEDED` **before** calling Telegraph; zero USDC is spent.
2. **Insufficient Testnet Balance:**
   - Run with an unfunded wallet → Agent checks on-chain Base Sepolia USDC balance via `viem` first and returns `INSUFFICIENT_TEST_USDC` with a direct link to the Circle faucet.

---

## Known Limitations & Roadmap
- **Testnet only:** Currently settles in Circle Test USDC on Base Sepolia (`eip155:84532`) against `devnode.telegraphprotocol.com`; not presented as paying mainnet production usage.
- **Submission delivery:** Generates a ready-to-file claim packet (text + JSON receipts) for the traveler to email/upload to the airline portal; automated airline-portal form submission is planned for v2.
- **Miner response variance:** Individual Telegraph miners may occasionally return generic guidance if live flight telemetry for a specific future date is unavailable; the full raw miner response and cost receipt are always surfaced transparently.

---

*Built solo by `@TestedByAura` (`AZERINVEST`) for Telegraph Protocol Hackathon Season II (Mission 15 — Consumer Automation).*
