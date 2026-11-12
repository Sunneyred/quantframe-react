import type { BookOrder, HistoryPoint, MarketOverview, MarketStar, OrderBook, PriceHistory, SellerStatus } from "@api/market";
import { hash01 } from "./layout";

/**
 * Demo market for the standalone game page (no Tauri): about 1,500 items shaped like the
 * backend's `vt_market_overview`, order books that drift between refreshes, and 90 days of
 * history. Deterministic per item, so a reload shows the same sky.
 */

const FRAMES = "Ash Atlas Banshee Baruuk Chroma Ember Equinox Frost Gara Garuda Harrow Hildryn Hydroid Inaros Ivara Khora Limbo Loki Mag Mesa Mirage Nekros Nezha Nidus Nova Nyx Oberon Octavia Revenant Rhino Saryn Titania Trinity Valkyr Vauban Volt Wisp Wukong Zephyr Gauss Grendel Protea Sevagoth Xaku Lavos".split(" ");
const WEAPONS = "Akbronco Akjagara Akstiletto Ankyros Astilla Bo Boar Boltor Braton Bronco Burston Cernos Corinth Dakra Destreza Dual-Kamas Euphona Fang Fragor Galatine Glaive Gram Guandao Gunsen Helios Kogake Kronen Lex Magnus Nami-Skyla Nikana Ninkondi Okina Orthos Panthera Paris Pyrana Reaper Redeemer Rubico Scindo Scourge Silva-and-Aegis Soma Spira Stradavar Strun Sybaris Tatsu Tekko Tenora Tiberon Tigris Vasto Vectis Venka Volnus Zakti Zhuge Knell Lato Pangolin Afuris Ballistica Kestrel Larkspur Nagantaka Quassus Velox Trumna Cobra-and-Crane Hikou Sicarus Fulmin Bronco Ceramic-Dagger Sarpa Vulkar Hate Ether-Sword Karyst".split(" ");
const WEAPON_PARTS = [
  ["Barrel", "Receiver", "Stock"],
  ["Blade", "Handle"],
  ["String", "Upper Limb", "Lower Limb", "Grip"],
  ["Link", "Gauntlet"],
];
const MODS = "Adaptation Arcane-Guardian-Mod Blind-Rage Condition-Overload Continuity Corrosive-Projection Energy-Siphon Fleeting-Expertise Flow Galvanized-Aptitude Galvanized-Chamber Galvanized-Hell Galvanized-Savvy Galvanized-Shot Hunter-Munitions Intensify Maiming-Strike Narrow-Minded Overextended Primed-Bane-of-Grineer Primed-Bane-of-Corpus Primed-Chamber Primed-Continuity Primed-Flow Primed-Fury Primed-Point-Blank Primed-Pressure-Point Primed-Reach Primed-Sure-Footed Primed-Target-Cracker Primed-Vigor Primed-Shred Primed-Cryo-Rounds Primed-Heated-Charge Primed-Firestorm Quick-Thinking Rage Rolling-Guard Steel-Charge Stretch Streamline Transient-Fortitude Umbral-Intensify Umbral-Fiber Umbral-Vitality Vigilante-Armaments Vigilante-Fervor Vigilante-Pursuit Vigilante-Supplies Vital-Sense Spoiled-Strike Organ-Shatter Blood-Rush Weeping-Wounds Gladiator-Might Gladiator-Rush Gladiator-Vice Sacrificial-Pressure Sacrificial-Steel Berserker-Fury Amalgam-Serration Amalgam-Barrel-Diffusion Amalgam-Organ-Shatter Archon-Continuity Archon-Flow Archon-Intensify Archon-Stretch Archon-Vitality Molt-Vigor Equilibrium Constitution Power-Drift Augur-Secrets Augur-Reach Augur-Message Augur-Pact Hunter-Adrenaline Hunter-Recovery Hunter-Synergy Mecha-Empowered Mecha-Overdrive Synth-Charge Synth-Deconstruct Tek-Collateral Tek-Gravity Vermillion-Storm Critical-Delay Hammer-Shot Vile-Acceleration Split-Chamber Serration Heavy-Caliber Point-Strike Vital-Sense Argon-Scope Bladed-Rounds Thermite-Rounds Rime-Rounds High-Voltage Malignant-Force Rumbled Overview Ice-Spring Shock-Absorbers Despoil Shield-of-Shadows Hushed-Invisibility Larva-Burst Pilfering-Swarm Resonating-Quake Tribunal Toxic-Flight Repelling-Bastille Abundant-Mutation Ironclad-Charge Iron-Vault Thrall-Pact Hallowed-Reckoning Shattered-Storm Swift-Bite Transistor-Shield Kinetic-Diversion Fatal-Acceleration Nightwatch-Napalm Combustion-Beam Healing-Return Seeking-Fury Seeking-Force Jolt Sanctuary Accumulating-Whipclaw Tesla-Bank Mind-Freak Ballistic-Bullseye Crash-Course Merciless-Gunner Deadly-Efficiency Electrified-Barrel Lasting-Covenant Volatile-Quick-Return Piercing-Fury Stockpiled-Blight Cautious-Shot Firewalker Aviator Rush Primed-Rush Mobilize Agility-Drift Coaction-Drift Endurance-Drift Natural-Talent Speed-Drift Stealth-Drift".split(" ");
const ARCANES = "Energize Grace Guardian Avenger Fury Strike Velocity Precision Acceleration Arachne Awakening Barrier Consequence Eruption Ice Momentum Nullifier Pulse Rage Tanker Trickery Ultimatum Victory Warmth Aegis Agility Blessing Deflection Healing Phantasm Resistance Reaper Bodyguard Battery Concentration Crepuscular Double-Back Escapist Fortifier Intention Persistence Power-Ramp Steadfast Tempo Universal-Fallout Molt-Augmented Molt-Efficiency Molt-Reconstruct Molt-Vigor Primary-Merciless Primary-Deadhead Primary-Dexterity Primary-Plated-Round Secondary-Merciless Secondary-Deadhead Secondary-Dexterity Secondary-Encumber Secondary-Fortifier Melee-Influence Melee-Exposure Melee-Duplicate Melee-Vortex Melee-Animosity Cascadia-Flare Cascadia-Overcharge Cascadia-Empowered Fractalized-Reset Conjunction-Voltage Emergence-Renewed Emergence-Dissipate Emergence-Savior Eternal-Eradicate Eternal-Onslaught Eternal-Logistics Magus-Elevate Magus-Melt Magus-Repair Magus-Lockdown Magus-Anomaly Magus-Destruct Magus-Cadence Exodia-Contagion Exodia-Epidemic Exodia-Force Exodia-Might Exodia-Hunt Exodia-Triumph Virtuos-Null Virtuos-Tempo Virtuos-Fury Virtuos-Strike Virtuos-Shadow Virtuos-Ghost Pax-Bolt Pax-Charge Pax-Seeker Pax-Soar".split(" ");
const RIVEN_WEAPONS = "Rubico Acceltra Ignis Catchmoon Kuva-Bramma Torid Rubico Lanka Vectis Opticor Tigris Hek Kohm Soma Braton Lenz Sybaris Stradavar Phantasma Ogris Tonkor Penta Quanta Amprex Synapse Glaxion Kulstar Pox Staticor Pyrana Zakti Atomos Catabolyst Kuva-Nukor Tenet-Cycron Twin-Grakatas Akarius Kompressa Detron Aklex Arca-Scisco Spira Hikou Kunai Ack-and-Brunt Galatine Gram Nikana Kronen Glaive Orthos Guandao Reaper Venka Pennant Fragor Scindo Gazal-Machete Heliocor Jat-Kittag Dark-Split-Sword Plague-Kripath Sarpa Redeemer Vastilok Xoris Tatsu Praedos Volnus Tenet-Exec Rauta Stropha Ceramic-Dagger Dual-Ichor Ninkondi Kogake Tekko Hirudo Ripkas Furax Fang Broken-War Skana Dakra Destreza Paracesis Silva-and-Aegis Kesheg Lesion Scoliac Orvius Lacera Galvacord Prova Mios Kesheg Rattleguts Catchmoon Tombfinger Gaze Sporelacer Vermisplicer Cyanex Bubonico Arca-Plasmor Phage Phantasma Basmu Ambassador Shedu Simulor Javlok Ferrox Battacor Ignis Komorex Proboscis Trumna".split(" ");
const OTHER = [
  "Ayatan Anasa Sculpture", "Ayatan Zambuka Sculpture", "Ayatan Orta Sculpture", "Ayatan Vaya Sculpture", "Ayatan Piv Sculpture", "Ayatan Valana Sculpture", "Ayatan Sah Sculpture", "Ayatan Ayr Sculpture", "Ayatan Kitha Sculpture", "Ayatan Hemakara Sculpture",
  "Legendary Fusion Core", "Legendary Core", "Scimitar Avionics", "Lohk Precepts", "Xata Precepts", "Jahu Precepts", "Vome Precepts", "Fass Precepts", "Netra Precepts", "Khra Precepts", "Ris Precepts",
  "Kavasa Prime Collar Set", "Kavasa Prime Buckle", "Kavasa Prime Band", "Kavasa Prime Kubrow Collar Blueprint", "Prisma Veritux", "Prisma Lenz", "Prisma Obex", "Prisma Skana", "Prisma Gorgon", "Prisma Grakata",
  "Wolf Sledge", "Snipetron Vandal", "Sheev", "Dex Furis", "Dex Sybaris", "Twin Basolk", "Imperator Vandal", "Gorgon Wraith", "Latron Wraith", "Strun Wraith", "Ballistica Prime", "Lato Vandal", "Braton Vandal",
  "Quellor Receiver", "Lacera Blade", "Tombfinger Barrel", "Hespar Blade", "Mausolon Receiver", "Morgha Barrel", "Cortege Stock", "Corvas Barrel", "Kuva Bramma Riven", "Entrati Lanthorn", "Somatic Fibers",
  "Ember Deluxe Skin", "Excalibur Proto Armor", "Kubrow Imprint", "Kavat Imprint", "Helminth Charger Imprint", "Necramech Vigor", "Necramech Intensify", "Necramech Streamline", "Necramech Flow", "Necramech Repair", "Necramech Rage", "Necramech Hydraulics", "Damaged Necramech Weapon Pod", "Damaged Necramech Engine", "Voidrig Neuroptics", "Bonewidow Capsule", "Arum Spinosa Guard",
  "Vengeful Toxin", "Vengeful Shockwave", "Vengeful Flame", "Vengeful Chill", "Vengeful Pull", "Vengeful Charge",
];
const RELIC_ERAS = ["Lith", "Meso", "Neo", "Axi"];

/** Items the demo stock, wish list and inventory refer to (see station/data/bridge.ts), with their prices. */
const KNOWN: Array<[string, string, number, number]> = [
  ["Glaive Prime Set", "set", 165, 48],
  ["Nova Prime Set", "set", 78, 35],
  ["Kronen Prime Set", "set", 92, 40],
  ["Burston Prime Set", "set", 24, 12],
  ["Wisp Prime Set", "set", 104, 56],
  ["Mesa Prime Systems Blueprint", "prime", 55, 28],
  ["Rhino Prime Chassis Blueprint", "prime", 22, 37],
  ["Akstiletto Prime Barrel", "prime", 9, 52],
  ["Glaive Prime Blade", "prime", 38, 61],
  ["Nova Prime Neuroptics Blueprint", "prime", 14, 44],
  ["Paris Prime Lower Limb", "prime", 4, 20],
  ["Soma Prime Stock", "prime", 6, 31],
  ["Primed Continuity", "mod", 62, 55],
  ["Primed Flow", "mod", 64, 41],
  ["Blind Rage", "mod", 12, 70],
  ["Narrow Minded", "mod", 18, 66],
  ["Condition Overload", "mod", 26, 80],
  ["Maiming Strike", "mod", 48, 33],
  ["Vigilante Armaments", "mod", 5, 90],
  ["Adaptation", "mod", 25, 58],
  ["Arcane Energize", "arcane", 34, 140],
  ["Arcane Grace", "arcane", 11, 95],
  ["Arcane Guardian", "arcane", 6, 110],
  ["Molt Augmented", "arcane", 9, 60],
  ["Axi L4 Relic", "relic", 6, 120],
  ["Neo N11 Relic", "relic", 5, 74],
  ["Lith G1 Relic", "relic", 5, 88],
  ["Ayatan Anasa Sculpture", "other", 9, 45],
  ["Legendary Fusion Core", "other", 210, 3],
  ["Scimitar Avionics", "other", 16, 8],
];

const slugOf = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const spaced = (s: string) => s.replace(/-/g, " ");

/** Lognormal-ish value from a hash: median m, spread s (factor). */
function lognorm(key: string, salt: number, m: number, s: number) {
  const u = hash01(key, salt) * 0.998 + 0.001;
  const v = hash01(key, salt + 1) * 0.998 + 0.001;
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return m * Math.pow(s, n);
}

function gauss(key: string, salt: number) {
  const u = hash01(key, salt) * 0.998 + 0.001;
  const v = hash01(key, salt + 1) * 0.998 + 0.001;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function star(name: string, category: string, price: number, volume: number, extra: Partial<MarketStar> = {}): MarketStar {
  const url = slugOf(name);
  const unknown = hash01(url, 91) < 0.05;
  let trend = Math.max(-0.6, Math.min(0.6, gauss(url, 31) * 0.085));
  // a few items in real motion, so the sky has visible weather
  if (hash01(url, 37) < 0.06) trend = (hash01(url, 41) < 0.5 ? -1 : 1) * (0.18 + hash01(url, 43) * 0.3);
  const dir = unknown ? "unknown" : trend > 0.05 ? "rising" : trend < -0.05 ? "falling" : "flat";
  const avg = Math.max(1, Math.round(price * 10) / 10);
  return {
    wfm_url: url,
    wfm_id: url,
    name,
    category,
    avg_price: avg,
    median: Math.round(avg),
    min_price: Math.max(1, Math.round(avg * (0.7 - hash01(url, 3) * 0.15))),
    max_price: Math.round(avg * (1.25 + hash01(url, 4) * 0.5)),
    volume: Math.round(volume * 10) / 10,
    moving_avg: unknown ? null : Math.round((avg / (1 + trend)) * 100) / 100,
    trend: unknown ? 0 : Math.round(trend * 1000) / 1000,
    trend_dir: dir,
    profit_margin: Math.round(avg * (0.1 + hash01(url, 5) * 0.25) * 10) / 10,
    variant: category === "mod" || category === "arcane" ? `r${category === "arcane" ? 5 : 10}` : category === "relic" ? "intact" : "",
    flags: { stock: false, live_order: false, wish: false, inventory: false, riven: category === "riven" },
    owned: 0,
    ...extra,
  };
}

let cached: MarketStar[] | null = null;

export function demoStars(): MarketStar[] {
  if (cached) return cached;
  const out = new Map<string, MarketStar>();
  const add = (s: MarketStar) => {
    if (!out.has(s.wfm_url)) out.set(s.wfm_url, s);
  };
  for (const [name, cat, price, vol] of KNOWN) add(star(name, cat, price, vol));
  for (const f of FRAMES) {
    const base = lognorm(f, 1, 70, 1.7);
    add(star(`${f} Prime Set`, "set", base, lognorm(f, 2, 22, 1.8)));
    for (const [i, part] of ["Blueprint", "Neuroptics Blueprint", "Chassis Blueprint", "Systems Blueprint"].entries())
      add(star(`${f} Prime ${part}`, "prime", lognorm(`${f}${part}`, 3, base * (i === 0 ? 0.18 : 0.22), 1.8), lognorm(`${f}${part}`, 4, 26, 1.9)));
  }
  WEAPONS.forEach((w, wi) => {
    const name = spaced(w);
    const base = lognorm(w, 5, 34, 2.0);
    add(star(`${name} Prime Set`, "set", base, lognorm(w, 6, 14, 2)));
    add(star(`${name} Prime Blueprint`, "prime", lognorm(w, 7, base * 0.12, 1.8), lognorm(w, 8, 18, 2)));
    for (const part of WEAPON_PARTS[wi % WEAPON_PARTS.length]) add(star(`${name} Prime ${part}`, "prime", lognorm(`${w}${part}`, 9, base * 0.22, 1.9), lognorm(`${w}${part}`, 10, 20, 2)));
  });
  for (const m of MODS) {
    const name = spaced(m);
    const primed = /^(Primed|Archon|Galvanized|Umbral|Amalgam)/.test(name);
    add(star(name, "mod", lognorm(m, 11, primed ? 70 : 14, 1.9), lognorm(m, 12, primed ? 18 : 30, 2)));
  }
  for (const a of ARCANES) {
    const name = /^(Molt|Primary|Secondary|Melee|Cascadia|Fractalized|Conjunction|Emergence|Eternal|Magus|Exodia|Virtuos|Pax)/.test(a) ? spaced(a) : `Arcane ${spaced(a)}`;
    add(star(name, "arcane", lognorm(a, 13, 22, 2.6), lognorm(a, 14, 40, 2.2)));
  }
  // relics: era + letter + number, a deterministic selection of about 300
  for (const era of RELIC_ERAS)
    for (let c = 0; c < 22; c++)
      for (let n = 1; n <= 12; n++) {
        const name = `${era} ${String.fromCharCode(65 + c)}${n} Relic`;
        if (hash01(name, 15) < 0.28) add(star(name, "relic", lognorm(name, 16, era === "Axi" ? 7 : 5, 1.7), lognorm(name, 17, 30, 2.2)));
      }
  for (const r of new Set(RIVEN_WEAPONS)) add(star(`${spaced(r)} Riven`, "riven", lognorm(r, 18, 140, 2.4), lognorm(r, 19, 14, 1.9)));
  for (const o of OTHER) add(star(o, "other", lognorm(o, 20, 25, 2.6), lognorm(o, 21, 9, 2.2)));
  cached = [...out.values()];
  return cached;
}

export function demoOverview(flags: (s: MarketStar) => Partial<MarketStar["flags"]> & { owned?: number }): MarketOverview {
  const items = demoStars().map((s) => {
    const f = flags(s);
    return { ...s, flags: { ...s.flags, ...f, riven: s.flags.riven }, owned: f.owned ?? 0 };
  });
  return {
    items,
    generated_at: new Date().toISOString(),
    trend_basis: "Demo data: trend = (avg - moving_avg) / moving_avg, flat within 5 %.",
    price_rows: items.length,
    rivens: items.filter((i) => i.flags.riven).length,
    history_days: 90,
  };
}

// ---------------------------------------------------------------------------
// Order books
// ---------------------------------------------------------------------------

const NAMES = ["StarHollow", "VoidRunner77", "Kestrel_9", "TradeKat", "PlatBaron", "QuietLantern", "Mirelle.Vant", "OrokinOtter", "LunaroLad", "Corpus_Coin", "TennoTrader", "Cephalon_Sly", "DriftwoodK", "AuricVale", "Nebula.Nix", "GrineerGrin", "ZarimanZed", "LotusLeaf", "PrimeTime", "RelicRaker"];

interface DemoBook {
  orders: BookOrder[];
  seq: number;
}
const books = new Map<string, DemoBook>();
const pendingUndercut = new Set<string>();

/** Dev helper: the next refresh of this item brings an in-game seller under your order. */
export function demoUndercut(url: string) {
  pendingUndercut.add(url);
}

function statusFor(key: string, salt: number): SellerStatus {
  const h = hash01(key, salt);
  return h < 0.45 ? "ingame" : h < 0.75 ? "online" : "offline";
}

function makeBook(s: MarketStar, own: { sell?: number; buy?: number }): BookOrder[] {
  const p = s.median || s.avg_price || 10;
  const orders: BookOrder[] = [];
  const nSell = 6 + Math.floor(hash01(s.wfm_url, 51) * 14);
  const nBuy = 3 + Math.floor(hash01(s.wfm_url, 52) * 8);
  const step = Math.max(1, Math.round(p * 0.04));
  // your own order starts as the best in game (an undercut is something that happens later)
  const floor = own.sell ? own.sell + 1 : Math.round(p * 0.94);
  for (let i = 0; i < nSell; i++) {
    const key = `${s.wfm_url}s${i}`;
    const price = Math.max(1, Math.round(floor + i * step * (0.6 + hash01(key, 1) * 1.2)));
    orders.push(order("sell", price, key, s.variant));
  }
  for (let i = 0; i < nBuy; i++) {
    const key = `${s.wfm_url}b${i}`;
    const price = Math.max(1, Math.round(p * 0.8 - i * step * (0.6 + hash01(key, 2))));
    orders.push(order("buy", price, key, s.variant));
  }
  if (own.sell) orders.push({ ...order("sell", own.sell, `${s.wfm_url}me`, s.variant), user: "You", status: "ingame", own: true });
  if (own.buy) orders.push({ ...order("buy", own.buy, `${s.wfm_url}mebuy`, s.variant), user: "You", status: "ingame", own: true });
  return orders;
}

function order(side: "sell" | "buy", price: number, key: string, variant: string): BookOrder {
  return {
    id: `demo-${key}`,
    side,
    platinum: price,
    quantity: 1 + Math.floor(hash01(key, 3) * hash01(key, 4) * 12),
    ...(variant.startsWith("r") ? { rank: Number(variant.slice(1)) } : {}),
    ...(variant && !variant.startsWith("r") ? { subtype: variant } : {}),
    variant,
    user: NAMES[Math.floor(hash01(key, 5) * NAMES.length)],
    status: statusFor(key, 6),
    reputation: Math.floor(hash01(key, 7) * 300),
    own: false,
    updated_at: new Date().toISOString(),
  };
}

/** One refresh of a demo book: a little churn every time (prices, statuses, a seller coming or going). */
export function demoBook(s: MarketStar, own: { sell?: number; buy?: number }): OrderBook {
  let b = books.get(s.wfm_url);
  if (!b) {
    b = { orders: makeBook(s, own), seq: 0 };
    books.set(s.wfm_url, b);
  } else {
    b.seq++;
    const r = (salt: number) => hash01(`${s.wfm_url}#${b!.seq}`, salt);
    b.orders = b.orders
      .filter((o) => o.own || r(o.platinum) > 0.08)
      .map((o) => (o.own ? o : { ...o, status: r(o.platinum + 9) < 0.15 ? statusFor(o.id + b!.seq, 2) : o.status }));
    if (r(1) < 0.6) {
      const sells = b.orders.filter((o) => o.side === "sell" && !o.own);
      const top = Math.min(...sells.map((o) => o.platinum));
      // new sellers come in at or above the cheapest other seller (undercuts are a separate event)
      b.orders.push(order("sell", Math.max(1, top + Math.round(r(2) * 6)), `${s.wfm_url}n${b.seq}`, s.variant));
    }
    // keep the own order in step with the stock list price
    b.orders = b.orders.filter((o) => !o.own);
    if (own.sell) b.orders.push({ ...order("sell", own.sell, `${s.wfm_url}me`, s.variant), user: "You", status: "ingame", own: true });
  }
  if (pendingUndercut.delete(s.wfm_url) && own.sell) {
    b.orders.push({ ...order("sell", Math.max(1, own.sell - 2), `${s.wfm_url}cut${b.seq}`, s.variant), user: "Kestrel_9", status: "ingame" });
  }
  return bookFrom(s, b.orders);
}

export function bookFrom(s: Pick<MarketStar, "wfm_url" | "name" | "variant">, all: BookOrder[]): OrderBook {
  const sells = all.filter((o) => o.side === "sell").sort((a, b) => a.platinum - b.platinum);
  const buys = all.filter((o) => o.side === "buy").sort((a, b) => b.platinum - a.platinum);
  const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  const bsi = min(sells.filter((o) => o.status === "ingame").map((o) => o.platinum));
  const bbi = max(buys.filter((o) => o.status === "ingame").map((o) => o.platinum));
  const ownSell = min(sells.filter((o) => o.own).map((o) => o.platinum));
  const other = min(sells.filter((o) => !o.own && o.status === "ingame").map((o) => o.platinum));
  const undercut = ownSell !== null && other !== null && other < ownSell ? ownSell - other : null;
  return {
    wfm_url: s.wfm_url,
    name: s.name,
    variant: s.variant,
    variants: s.variant ? [{ key: s.variant, label: s.variant.startsWith("r") ? `Rank ${s.variant.slice(1)}` : s.variant[0].toUpperCase() + s.variant.slice(1), sells: sells.length, buys: buys.length, sells_ingame: sells.filter((o) => o.status === "ingame").length }] : [],
    sells,
    buys,
    summary: {
      best_sell_ingame: bsi,
      best_sell_online: min(sells.filter((o) => o.status !== "offline").map((o) => o.platinum)),
      best_sell_any: min(sells.map((o) => o.platinum)),
      best_buy_ingame: bbi,
      best_buy_any: max(buys.map((o) => o.platinum)),
      spread: bsi !== null && bbi !== null ? bsi - bbi : null,
      sellers_ingame: sells.filter((o) => o.status === "ingame").length,
      buyers_ingame: buys.filter((o) => o.status === "ingame").length,
      sell_count: sells.length,
      buy_count: buys.length,
      own_sell: ownSell,
      own_buy: max(buys.filter((o) => o.own).map((o) => o.platinum)),
      undercut_by: undercut,
      own_is_best: ownSell !== null && undercut === null,
    },
    fetched_at: new Date().toISOString(),
    age_secs: 0,
    from_cache: false,
    ttl_secs: 40,
  };
}

export function demoHistory(s: MarketStar): PriceHistory {
  const days = 90;
  const points: HistoryPoint[] = [];
  const end = s.avg_price || 10;
  const start = s.moving_avg ? end / (1 + s.trend * 2.2) : end;
  let wobble = 0;
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1);
    wobble = wobble * 0.85 + gauss(s.wfm_url, 200 + i) * 0.05;
    const avg = Math.max(1, (start + (end - start) * t) * (1 + wobble));
    const spreadLo = 0.12 + hash01(s.wfm_url, 300 + i) * 0.15;
    const spreadHi = 0.15 + hash01(s.wfm_url, 400 + i) * 0.3;
    const d = new Date(Date.now() - (days - 1 - i) * 86400000);
    points.push({
      date: d.toISOString().slice(0, 10) + "T00:00:00Z",
      avg: Math.round(avg * 10) / 10,
      median: Math.round(avg),
      min: Math.max(1, Math.round(avg * (1 - spreadLo))),
      max: Math.round(avg * (1 + spreadHi)),
      volume: Math.max(0, Math.round(s.volume * (0.6 + hash01(s.wfm_url, 500 + i) * 0.8 + (i % 7 >= 5 ? 0.25 : 0)))),
    });
  }
  return {
    wfm_url: s.wfm_url,
    source: "wfm_statistics_90d",
    note: "Demo data: 90 invented days.",
    points,
    snapshot: { avg: s.avg_price, min: s.min_price, max: s.max_price, median: s.median, volume: s.volume, moving_avg: s.moving_avg, variant: s.variant },
    variant: s.variant,
  };
}
