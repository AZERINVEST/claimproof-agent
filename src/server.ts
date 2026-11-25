import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BudgetCapError,
  InsufficientFundsError,
  readLedger,
  runClaimProofAgent,
  type ClaimInput,
} from './agent.js';
import { getAgentAccount, getBaseSepoliaUsdcBalance } from './telegraph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3456);

app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../public')));

app.get('/api/status', async (_req, res) => {
  try {
    const account = getAgentAccount();
    const usdcBalance = await getBaseSepoliaUsdcBalance(account.address);
    const ledger = readLedger();
    const ledgerTotalUsd = ledger.reduce((sum, item) => sum + (item.totalCostUsd || 0), 0);
    res.json({
      ok: true,
      walletAddress: account.address,
      usdcBalance,
      ledgerCount: ledger.length,
      ledgerTotalUsd: Number(ledgerTotalUsd.toFixed(4)),
    });
  } catch (err: unknown) {
    res.json({
      ok: false,
      walletAddress: null,
      usdcBalance: 0,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get('/api/ledger', (_req, res) => {
  res.json({ runs: readLedger() });
});

app.post('/api/claim', async (req, res) => {
  try {
    const body = req.body as Partial<ClaimInput>;
    if (!body.flightNumber || !body.origin || !body.destination || !body.airline) {
      res.status(400).json({ error: 'Missing required flight fields (flightNumber, airline, origin, destination).' });
      return;
    }
    const input: ClaimInput = {
      flightNumber: String(body.flightNumber).trim(),
      airline: String(body.airline).trim(),
      origin: String(body.origin).trim().toUpperCase(),
      destination: String(body.destination).trim().toUpperCase(),
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      ticketPriceUsd: Number(body.ticketPriceUsd || 500),
      fareClass: String(body.fareClass || 'Economy Light'),
      bookingRef: String(body.bookingRef || 'DEMO01').trim(),
      passengerName: String(body.passengerName || 'Alex Rivera').trim(),
      maxBudgetUsd: Number(body.maxBudgetUsd ?? process.env.MAX_BUDGET_USD ?? 0.03),
      includeRebooking: Boolean(body.includeRebooking),
    };

    const packet = await runClaimProofAgent(input);
    res.json(packet);
  } catch (err: unknown) {
    if (err instanceof BudgetCapError || err instanceof InsufficientFundsError) {
      res.status(402).json({ code: err.code, error: err.message, detail: err.detail });
      return;
    }
    res.status(500).json({
      code: 'AGENT_ERROR',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`ClaimProof Agent running at http://localhost:${PORT}`);
});
