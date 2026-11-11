/** Pure simulation rules: level easing, surge sizing, sale detection, customer queue. No Pixi, no DOM. */

export interface GoalSnapshot {
  platinum: number;
  floor: number;
  goal: number;
  progress: number;
  daily_target: number;
  avg_daily_profit?: number;
  profit_today: number;
  balance_is_live: boolean;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Frame-rate independent exponential ease of `current` toward `target`. */
export function easeLevel(current: number, target: number, dt: number, rate = 0.9): number {
  if (!Number.isFinite(current)) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0005 ? target : next;
}

/** Map goal progress (0..1, may overshoot) to the filled fraction of the glass. */
export function progressToFill(progress: number, fillMin: number, fillGoal: number): number {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1.12);
  return clamp(fillMin + (fillGoal - fillMin) * p, 0.02, 0.97);
}

export function progressOf(platinum: number, floor: number, goal: number): number {
  const span = goal - floor;
  if (span <= 0) return 1;
  return clamp((platinum - floor) / span, 0, 1);
}

/**
 * Platinum gained between two polls. A rising balance wins; otherwise a rising
 * profit_today counts (covers estimated balances). Zero when nothing rose.
 */
export function detectSale(prev: GoalSnapshot | null, next: GoalSnapshot): number {
  if (!prev) return 0;
  const byBalance = next.platinum - prev.platinum;
  const byProfit = next.profit_today - prev.profit_today;
  if (byBalance > 0) return Math.round(byBalance);
  if (byProfit > 0) return Math.round(byProfit);
  return 0;
}

export interface SurgePlan {
  /** Droplets to pour in total. */
  particles: number;
  /** Seconds the pipe stays open. */
  duration: number;
  /** Initial slosh kick, in pixels per second of surface velocity. */
  kick: number;
}

/** Size a surge to the gain, relative to the size of the goal. */
export function planSurge(gain: number, goalSpan: number, lowPower: boolean): SurgePlan {
  const g = Math.max(1, gain);
  const share = clamp(g / Math.max(1, goalSpan), 0, 1);
  // sqrt so small sales still read, and whales do not flood the frame budget
  const size = clamp(Math.sqrt(share) * 1.6 + g / 400, 0.12, 1.5);
  const particles = Math.round(clamp(40 + size * 300, 40, 480) * (lowPower ? 0.45 : 1));
  const duration = clamp(0.7 + size * 2.6, 0.7, 4.5);
  const kick = clamp(8 + size * 30, 8, 55);
  return { particles, duration, kick };
}

// ---------------------------------------------------------------------------
// Customer queue
// ---------------------------------------------------------------------------

export type BuyerSource = "wfm_chat" | "whisper" | "debug";

export interface Buyer {
  id: string;
  name: string;
  /** In-game name usable in /w and /inv, when the event gave us one. */
  commandName?: string;
  source: BuyerSource;
  message?: string;
  chatName?: string;
  reputation?: number;
  status?: string;
  receivedAt: number;
  /** How many events this buyer has sent while waiting. */
  pings: number;
}

export interface QueueResult {
  queue: Buyer[];
  /** The buyer that was added or refreshed, if any. */
  buyer: Buyer | null;
  added: boolean;
}

export const sameBuyer = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Add a buyer to the queue. A buyer who is already waiting keeps their place and
 * just gets their latest message; a full queue drops the newcomer.
 */
export function enqueueBuyer(queue: Buyer[], incoming: Omit<Buyer, "pings">, capacity: number): QueueResult {
  const name = incoming.name.trim();
  if (!name) return { queue, buyer: null, added: false };
  const at = queue.findIndex((b) => sameBuyer(b.name, name));
  if (at >= 0) {
    const merged: Buyer = {
      ...queue[at],
      message: incoming.message ?? queue[at].message,
      commandName: incoming.commandName ?? queue[at].commandName,
      receivedAt: incoming.receivedAt,
      pings: queue[at].pings + 1,
    };
    const next = queue.slice();
    next[at] = merged;
    return { queue: next, buyer: merged, added: false };
  }
  if (queue.length >= capacity) return { queue, buyer: null, added: false };
  const buyer: Buyer = { ...incoming, name, pings: 1 };
  return { queue: [...queue, buyer], buyer, added: true };
}

export function dismissBuyer(queue: Buyer[], id: string): Buyer[] {
  return queue.filter((b) => b.id !== id);
}

/** Slot index for each queued buyer id (front of queue is slot 0). */
export function queueSlots(queue: Buyer[]): Map<string, number> {
  return new Map(queue.map((b, i) => [b.id, i]));
}

/** Chat commands to paste into Warframe. */
export const whisperCommand = (name: string) => `/w ${name} Hi! Still available, inviting you now.`;
export const inviteCommand = (name: string) => `/inv ${name}`;

/** Stable small hash for picking a customer colour from a name. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
