import 'dotenv/config';
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';

export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const TELEGRAPH_BASE_URL = (process.env.TELEGRAPH_BASE_URL || 'https://devnode.telegraphprotocol.com').replace(/\/$/, '');
export const COST_PER_ASK_USD = 0.01;

const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
]);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org'),
});

export interface TelegraphPurchaseResult {
  intent: string;
  query: string;
  ok: boolean;
  costUsd: number;
  latencyMs: number;
  minerId: string | null;
  txHash: string | null;
  network: string;
  payer: string;
  paymentReceiptRaw: Record<string, unknown> | null;
  answer: string;
  rawResponse?: unknown;
  error?: string;
}

export function getAgentAccount() {
  const key = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key || !key.startsWith('0x') || key.length !== 66 || /^0x0+$/.test(key)) {
    throw new Error('AGENT_PRIVATE_KEY is missing or placeholder in .env. Run `npm run wallet:new` first.');
  }
  return privateKeyToAccount(key);
}

export async function getBaseSepoliaUsdcBalance(address: `0x${string}`): Promise<number> {
  const raw = await publicClient.readContract({
    address: BASE_SEPOLIA_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
  return Number(formatUnits(raw, 6));
}

let cachedPaidFetch: typeof fetch | null = null;

function getPaidFetch(): typeof fetch {
  if (cachedPaidFetch) return cachedPaidFetch;
  const account = getAgentAccount();
  cachedPaidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: 'eip155:84532',
        client: new ExactEvmScheme(account),
      },
    ],
  });
  return cachedPaidFetch;
}

function extractAnswerText(body: unknown): { answer: string; minerId: string | null } {
  if (!body || typeof body !== 'object') {
    return { answer: String(body ?? ''), minerId: null };
  }
  const obj = body as Record<string, unknown>;
  const minerId =
    (typeof obj.miner_id === 'string' && obj.miner_id) ||
    (typeof obj.minerId === 'string' && obj.minerId) ||
    (typeof obj.miner === 'string' && obj.miner) ||
    (typeof obj.provider === 'string' && obj.provider) ||
    null;

  const candidates = [
    obj.answer,
    obj.response,
    obj.result,
    obj.content,
    obj.text,
    (obj.data as Record<string, unknown> | undefined)?.answer,
    (obj.data as Record<string, unknown> | undefined)?.response,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return { answer: c.trim(), minerId };
    }
    if (c && typeof c === 'object') {
      return { answer: JSON.stringify(c, null, 2), minerId };
    }
  }
  return { answer: JSON.stringify(obj, null, 2), minerId };
}

export async function purchaseTelegraphIntelligence(
  intent: string,
  query: string,
  params?: Record<string, unknown>
): Promise<TelegraphPurchaseResult> {
  const account = getAgentAccount();
  const paidFetch = getPaidFetch();
  const started = Date.now();
  const url = `${TELEGRAPH_BASE_URL}/engine/v1/ask`;

  const payload: Record<string, unknown> = { query, intent };
  if (params && Object.keys(params).length > 0) {
    payload.params = params;
  }

  try {
    const response = await paidFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const latencyMs = Date.now() - started;
    const rawHeader =
      response.headers.get('payment-response') ||
      response.headers.get('x-payment-response');

    let decodedReceipt: Record<string, unknown> | null = null;
    if (rawHeader) {
      try {
        decodedReceipt = decodePaymentResponseHeader(rawHeader) as unknown as Record<string, unknown>;
      } catch {
        decodedReceipt = { rawHeader };
      }
    }

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }

    if (!response.ok) {
      return {
        intent,
        query,
        ok: false,
        costUsd: 0,
        latencyMs,
        minerId: null,
        txHash: null,
        network: 'eip155:84532',
        payer: account.address,
        paymentReceiptRaw: decodedReceipt,
        answer: '',
        rawResponse: parsed,
        error: `HTTP ${response.status}: ${typeof parsed === 'string' ? parsed.slice(0, 300) : JSON.stringify(parsed).slice(0, 300)}`,
      };
    }

    const { answer, minerId } = extractAnswerText(parsed);
    const txHash =
      (decodedReceipt && typeof decodedReceipt.transaction === 'string' && decodedReceipt.transaction) ||
      (decodedReceipt && typeof decodedReceipt.txHash === 'string' && decodedReceipt.txHash) ||
      null;

    return {
      intent,
      query,
      ok: true,
      costUsd: COST_PER_ASK_USD,
      latencyMs,
      minerId,
      txHash,
      network: 'eip155:84532',
      payer: account.address,
      paymentReceiptRaw: decodedReceipt,
      answer,
      rawResponse: parsed,
    };
  } catch (err: unknown) {
    return {
      intent,
      query,
      ok: false,
      costUsd: 0,
      latencyMs: Date.now() - started,
      minerId: null,
      txHash: null,
      network: 'eip155:84532',
      payer: account.address,
      paymentReceiptRaw: null,
      answer: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
