import { Container } from "pixi.js";
import { CUSTOMER_SPEED, DOOR_INSIDE, DOOR_SPAWN, QUEUE_SLOTS, queueSlot } from "../engine/constants";
import { dismissBuyer, enqueueBuyer, hashString, queueSlots, type Buyer } from "../engine/logic";
import { Character, customerPalette, dirFromVector } from "./character";

type Phase = "entering" | "waiting" | "leaving";

interface Point {
  x: number;
  y: number;
}

export class Customer {
  readonly sprite: Character;
  x = DOOR_SPAWN.x;
  y = DOOR_SPAWN.y;
  phase: Phase = "entering";
  slot = -1;
  /** Seconds since arriving at the counter; drives the bubble bounce. */
  waited = 0;
  private path: Point[] = [];

  constructor(public buyer: Buyer) {
    this.sprite = new Character(customerPalette(hashString(buyer.name)));
    this.sprite.dir = "left";
    this.sprite.setPosition(this.x, this.y);
  }

  assignSlot(slot: number) {
    if (slot === this.slot || this.phase === "leaving") return;
    const first = this.slot < 0;
    this.slot = slot;
    const s = queueSlot(slot);
    this.path = first ? [DOOR_INSIDE, { x: s.x, y: DOOR_INSIDE.y }, s] : [s];
    if (this.phase === "waiting") this.phase = "entering";
  }

  leave() {
    if (this.phase === "leaving") return;
    this.phase = "leaving";
    this.path = [{ x: this.x, y: DOOR_INSIDE.y }, DOOR_INSIDE, DOOR_SPAWN];
  }

  /** Returns true once the customer has walked out and can be removed. */
  update(dt: number): boolean {
    const next = this.path[0];
    if (next) {
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const dist = Math.hypot(dx, dy);
      const step = CUSTOMER_SPEED * (this.phase === "leaving" ? 1.3 : 1) * dt;
      if (dist <= step) {
        this.x = next.x;
        this.y = next.y;
        this.path.shift();
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.sprite.dir = dirFromVector(dx, dy, this.sprite.dir);
      }
      this.sprite.walking = true;
    } else {
      this.sprite.walking = false;
      if (this.phase === "entering") {
        this.phase = "waiting";
        this.waited = 0;
        this.sprite.dir = "up"; // face the counter
      } else if (this.phase === "leaving") {
        return true;
      }
    }
    if (this.phase === "waiting") this.waited += dt;
    this.sprite.setPosition(this.x, this.y);
    this.sprite.update(dt);
    return false;
  }
}

/** Owns the buyer queue and the customer sprites that act it out. */
export class Customers {
  private queue: Buyer[] = [];
  private list: Customer[] = [];

  constructor(private layer: Container) {}

  /** Queue a buyer. Returns the customer that now represents them, and whether they are new. */
  add(incoming: Omit<Buyer, "pings">): { customer: Customer | null; added: boolean } {
    const res = enqueueBuyer(this.queue, incoming, QUEUE_SLOTS);
    this.queue = res.queue;
    if (!res.buyer) return { customer: null, added: false };
    let customer = this.list.find((c) => c.buyer.id === res.buyer!.id && c.phase !== "leaving") ?? null;
    if (customer) {
      customer.buyer = res.buyer;
    } else {
      customer = new Customer(res.buyer);
      this.list.push(customer);
      this.layer.addChild(customer.sprite.view);
    }
    this.reslot();
    return { customer, added: res.added };
  }

  dismiss(id: string) {
    this.queue = dismissBuyer(this.queue, id);
    for (const c of this.list) if (c.buyer.id === id) c.leave();
    this.reslot();
  }

  private reslot() {
    const slots = queueSlots(this.queue);
    for (const c of this.list) {
      const slot = slots.get(c.buyer.id);
      if (slot !== undefined) c.assignSlot(slot);
    }
  }

  /** Customers still in the queue, front first. */
  get active(): Customer[] {
    return this.list.filter((c) => c.phase !== "leaving").sort((a, b) => a.slot - b.slot);
  }

  get all(): readonly Customer[] {
    return this.list;
  }

  get head(): Customer | null {
    return this.active[0] ?? null;
  }

  nearest(x: number, y: number, range: number): Customer | null {
    let best: Customer | null = null;
    let bestD = range;
    for (const c of this.list) {
      if (c.phase === "leaving") continue;
      const d = Math.hypot(c.x - x, c.y - 4 - y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Customer whose sprite is under a point (for clicks). */
  at(x: number, y: number): Customer | null {
    for (const c of this.list) {
      if (c.phase === "leaving") continue;
      if (Math.abs(x - c.x) <= 8 && y >= c.y - 22 && y <= c.y + 4) return c;
    }
    return null;
  }

  update(dt: number): Customer[] {
    const gone: Customer[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.update(dt)) {
        gone.push(c);
        this.list.splice(i, 1);
        this.layer.removeChild(c.sprite.view);
        c.sprite.destroy();
      }
    }
    return gone;
  }

  destroy() {
    for (const c of this.list) c.sprite.destroy();
    this.list = [];
    this.queue = [];
  }
}
