import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  COST_PER_ASK_USD,
  getAgentAccount,
  getBaseSepoliaUsdcBalance,
  purchaseTelegraphIntelligence,
  type TelegraphPurchaseResult,
} from './telegraph.js';

export interface ClaimInput {
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  date: string;
  ticketPriceUsd: number;
  fareClass: string;
  bookingRef: string;
  passengerName: string;
  maxBudgetUsd: number;
  includeRebooking: boolean;
}

export interface ClaimPacket {
  claimId: string;
  createdAt: string;
  status: 'CLAIM_READY' | 'PARTIAL_EVIDENCE' | 'FAILED';
  mission: string;
  network: string;
  payerWallet: string;
  input: ClaimInput;
  maxBudgetUsd: number;
  totalCostUsd: number;
  purchases: TelegraphPurchaseResult[];
  claimLetter: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.json');

export function readLedger(): ClaimPacket[] {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as ClaimPacket[];
  } catch {
    return [];
  }
}

function appendLedger(packet: ClaimPacket) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const existing = readLedger();
  existing.unshift(packet);
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(existing.slice(0, 100), null, 2));
}

export class BudgetCapError extends Error {
  code = 'BUDGET_CAP_EXCEEDED';
  detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

export class InsufficientFundsError extends Error {
  code = 'INSUFFICIENT_TEST_USDC';
  detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

function buildClaimLetter(
  claimId: string,
  createdAt: string,
  input: ClaimInput,
  purchases: TelegraphPurchaseResult[],
  totalCostUsd: number,
  payerWallet: string
): string {
  const disruption = purchases.find((p) => p.intent === 'TRAVEL_DISRUPTION_GENERAL');
  const fareRules = purchases.find((p) => p.intent === 'FARE_RULE_VERIFY_GENERAL');
  const rebooking = purchases.find((p) => p.intent === 'FLIGHT_AVAILABILITY_GENERAL');

  const receiptLines = purchases.map((p, i) => {
    const txLine = p.txHash
      ? `https://sepolia.basescan.org/tx/${p.txHash}`
      : 'x402 settled (see JSON paymentReceiptRaw)';
    return `  ${i + 1}. Intent: ${p.intent}\n     Cost: $${p.costUsd.toFixed(2)} USDC (Base Sepolia x402) | Latency: ${p.latencyMs}ms | Miner: ${p.minerId || 'auto-routed'}\n     Proof: ${txLine}`;
  });

  return [
    `FORMAL FLIGHT DISRUPTION REFUND & COMPENSATION CLAIM`,
    `====================================================`,
    `Claim ID:       ${claimId}`,
    `Generated UTC:  ${createdAt}`,
    `Passenger:      ${input.passengerName}`,
    `Airline:        ${input.airline}`,
    `Flight:         ${input.flightNumber} (${input.origin} -> ${input.destination}) on ${input.date}`,
    `Booking (PNR):  ${input.bookingRef}`,
    `Fare Class:     ${input.fareClass} | Ticket Value: $${input.ticketPriceUsd} USD`,
    ``,
    `1. REQUEST`,
    `----------`,
    `I am formally requesting a refund and/or statutory delay/cancellation compensation`,
    `(under EU Regulation 261/2004, UK261, or US DOT Automatic Refund Rules as applicable)`,
    `for disrupted flight ${input.flightNumber} (${input.origin} -> ${input.destination}) on ${input.date}.`,
    ``,
    `2. INDEPENDENTLY VERIFIED DISRUPTION REPORT (Telegraph: TRAVEL_DISRUPTION_GENERAL)`,
    `----------------------------------------------------------------------------------`,
    disruption?.ok ? disruption.answer : `(Unavailable: ${disruption?.error || 'not executed'})`,
    ``,
    `3. VERIFIED FARE & STATUTORY REFUND RULES (Telegraph: FARE_RULE_VERIFY_GENERAL)`,
    `-------------------------------------------------------------------------------`,
    fareRules?.ok ? fareRules.answer : `(Unavailable: ${fareRules?.error || 'not executed'})`,
    ...(rebooking
      ? [
          ``,
          `4. LIVE REBOOKING AVAILABILITY CHECK (Telegraph: FLIGHT_AVAILABILITY_GENERAL)`,
          `-----------------------------------------------------------------------------`,
          rebooking.ok ? rebooking.answer : `(Unavailable: ${rebooking.error || 'not executed'})`,
        ]
      : []),
    ``,
    `CRYPTOGRAPHIC INTELLIGENCE RECEIPT (TELEGRAPH PROTOCOL x402)`,
    `------------------------------------------------------------`,
    `Payer Agent Wallet:  ${payerWallet}`,
    `Settlement Network:  Base Sepolia (eip155:84532, Circle Test USDC)`,
    `Total Intel Spend:   $${totalCostUsd.toFixed(2)} USDC (${((totalCostUsd / Math.max(1, input.ticketPriceUsd)) * 100).toFixed(4)}% of ticket value)`,
    ...receiptLines,
    ``,
    `Please confirm receipt of this claim and advise on payout timeline to the original payment method.`,
    `Sincerely,`,
    `${input.passengerName}`,
  ].join('\n');
}

export async function runClaimProofAgent(input: ClaimInput): Promise<ClaimPacket> {
  const plannedSteps = input.includeRebooking ? 3 : 2;
  const plannedCostUsd = Number((plannedSteps * COST_PER_ASK_USD).toFixed(4));

  // Safety guard 1: Hard budget cap check BEFORE any network spend
  if (plannedCostUsd > input.maxBudgetUsd) {
    throw new BudgetCapError(
      `Refused to execute: planned intelligence cost ($${plannedCostUsd.toFixed(2)}) exceeds your hard budget cap ($${input.maxBudgetUsd.toFixed(2)}).`,
      `Reduce queries (uncheck rebooking to spend $0.02) or raise Max Budget Cap to at least $${plannedCostUsd.toFixed(2)}. Zero USDC was spent.`
    );
  }

  const account = getAgentAccount();

  // Safety guard 2: Verify Base Sepolia USDC balance BEFORE signing x402 authorizations
  const balance = await getBaseSepoliaUsdcBalance(account.address);
  if (balance < plannedCostUsd) {
    throw new InsufficientFundsError(
      `Insufficient Base Sepolia Test USDC: wallet has $${balance.toFixed(4)}, needs $${plannedCostUsd.toFixed(2)}.`,
      `Fund throwaway wallet ${account.address} with free Base Sepolia USDC at https://faucet.circle.com/ (no ETH gas needed for x402).`
    );
  }

  const queries: Array<{ intent: string; query: string; params?: Record<string, unknown> }> = [
    {
      intent: 'TRAVEL_DISRUPTION_GENERAL',
      query: `Check operational disruption status, delays, or cancellations for ${input.airline} flight ${input.flightNumber} from ${input.origin} to ${input.destination} on ${input.date}, including airport disruption conditions at ${input.origin} and ${input.destination}.`,
    },
    {
      intent: 'FARE_RULE_VERIFY_GENERAL',
      query: `Verify airline refund and statutory compensation rules (EU261, UK261, US DOT) for a ${input.airline} ${input.fareClass} ticket on route ${input.origin} to ${input.destination} (flight ${input.flightNumber}) in the event of a significant delay or cancellation.`,
      params: {
        fare: `${input.airline} ${input.fareClass} ${input.origin}-${input.destination} (${input.flightNumber})`,
      },
    },
  ];

  if (input.includeRebooking) {
    queries.push({
      intent: 'FLIGHT_AVAILABILITY_GENERAL',
      query: `Check alternative same-day or next-day flight seat availability and fare classes from ${input.origin} to ${input.destination} around ${input.date} for rebooking a disrupted ${input.airline} passenger.`,
      params: {
        flight: `${input.flightNumber} ${input.origin}-${input.destination} ${input.date}`,
      },
    });
  }

  const purchases: TelegraphPurchaseResult[] = [];
  let totalCostUsd = 0;

  for (const step of queries) {
    if (Number((totalCostUsd + COST_PER_ASK_USD).toFixed(4)) > input.maxBudgetUsd) {
      break;
    }
    const res = await purchaseTelegraphIntelligence(step.intent, step.query, step.params);
    purchases.push(res);
    if (res.ok) {
      totalCostUsd = Number((totalCostUsd + res.costUsd).toFixed(4));
    }
  }

  const okCount = purchases.filter((p) => p.ok).length;
  const status: ClaimPacket['status'] =
    okCount === purchases.length ? 'CLAIM_READY' : okCount > 0 ? 'PARTIAL_EVIDENCE' : 'FAILED';

  const claimId = `CP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const createdAt = new Date().toISOString();
  const claimLetter = buildClaimLetter(claimId, createdAt, input, purchases, totalCostUsd, account.address);

  const packet: ClaimPacket = {
    claimId,
    createdAt,
    status,
    mission: 'Mission 15 — Consumer Automation (Flight Disruption Refund Agent)',
    network: 'Base Sepolia (eip155:84532)',
    payerWallet: account.address,
    input,
    maxBudgetUsd: input.maxBudgetUsd,
    totalCostUsd,
    purchases,
    claimLetter,
  };

  appendLedger(packet);
  return packet;
}
