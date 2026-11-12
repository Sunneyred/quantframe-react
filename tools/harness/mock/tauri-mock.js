// Void Trader test harness: a mock Tauri backend that lives in the page.
//
// Injected by tools/harness/run.py (Playwright addInitScript) BEFORE the app boots. It is never
// imported by the app and never part of the production build.
//
// What it does:
//   - provides window.__TAURI_INTERNALS__ (invoke, transformCallback, convertFileSrc, metadata)
//     and window.__TAURI_EVENT_PLUGIN_INTERNALS__, the only things @tauri-apps/api v2 needs;
//   - answers every app command the frontend calls with data shaped like the Rust structs
//     (see src-tauri/src/commands/** and the entity crate), keeping state so mutations round-trip;
//   - enforces the Rust contract (tools/harness/contract.json, generated from the Rust source):
//     an unregistered command is rejected like Tauri rejects it, a missing required argument or a
//     wrong primitive type is rejected like serde rejects it; every violation is recorded;
//   - enforces the plugin permissions listed in src-tauri/capabilities/*.json;
//   - records unknown (unhandled) commands loudly;
//   - lets the test emit backend events into the app (window.__HARNESS__.emit...).
//
// The two placeholders below (contract and options) are filled in by the runner.
(() => {
  "use strict";
  if (window.__HARNESS__) return;
  const CONTRACT = __CONTRACT__;
  const OPTIONS = Object.assign({ loggedIn: true, tosAccepted: true, tosText: "", updateAvailable: false, started: true, alerts: true, corrupt: "", inventory: "connected", platinum: 312, latency: 4, permissions: [] }, __OPTIONS__);

  // ------------------------------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------------------------------
  let seed = 20261111;
  const rnd = () => {
    // mulberry32: deterministic data on every run
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
  const slug = (name) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const iso = (d) => new Date(d).toISOString();
  const DAY = 86400000;
  const NOW = Date.now();
  const snake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

  /** Same JSON shape as utils::Error. */
  const rustError = (component, message, extra) => ({ component, message, cause: "", log_level: "error", location: `mock:${component}`, ...(extra || {}) });

  // ------------------------------------------------------------------------------------------
  // catalogue (cache_get_tradable_items)
  // ------------------------------------------------------------------------------------------
  // [name, tags, price, volume, maxRank?]
  const CATALOGUE = [
    ["Glaive Prime Set", ["set", "prime", "weapon"], 165, 48],
    ["Glaive Prime Blade", ["component", "prime", "weapon"], 38, 61],
    ["Glaive Prime Disc", ["component", "prime", "weapon"], 30, 40],
    ["Nova Prime Set", ["set", "prime", "warframe"], 78, 35],
    ["Nova Prime Neuroptics Blueprint", ["component", "prime", "warframe", "blueprint"], 14, 44],
    ["Nova Prime Chassis Blueprint", ["component", "prime", "warframe", "blueprint"], 22, 39],
    ["Kronen Prime Set", ["set", "prime", "weapon"], 92, 40],
    ["Kronen Prime Blade", ["component", "prime", "weapon"], 21, 33],
    ["Mesa Prime Set", ["set", "prime", "warframe"], 140, 52],
    ["Mesa Prime Systems Blueprint", ["component", "prime", "warframe", "blueprint"], 55, 28],
    ["Rhino Prime Set", ["set", "prime", "warframe"], 120, 30],
    ["Rhino Prime Chassis Blueprint", ["component", "prime", "warframe", "blueprint"], 22, 37],
    ["Wisp Prime Set", ["set", "prime", "warframe"], 104, 44],
    ["Akstiletto Prime Barrel", ["component", "prime", "weapon"], 9, 52],
    ["Soma Prime Stock", ["component", "prime", "weapon"], 6, 31],
    ["Paris Prime Lower Limb", ["component", "prime", "weapon"], 4, 20],
    ["Burston Prime Set", ["set", "prime", "weapon"], 24, 12],
    ["Nikana Prime Blade", ["component", "prime", "weapon"], 17, 26],
    ["Primed Continuity", ["mod", "legendary", "warframe"], 62, 55, 10],
    ["Primed Flow", ["mod", "legendary", "warframe"], 70, 49, 10],
    ["Blind Rage", ["mod", "rare", "warframe", "corrupted"], 12, 70, 10],
    ["Narrow Minded", ["mod", "rare", "warframe", "corrupted"], 18, 66, 10],
    ["Condition Overload", ["mod", "rare", "melee"], 26, 80, 5],
    ["Maiming Strike", ["mod", "rare", "melee", "acolyte"], 48, 33, 5],
    ["Vigilante Armaments", ["mod", "uncommon", "primary"], 5, 90, 5],
    ["Adaptation", ["mod", "rare", "warframe"], 25, 61, 10],
    ["Transient Fortitude", ["mod", "rare", "warframe", "corrupted"], 9, 58, 10],
    ["Overextended", ["mod", "rare", "warframe", "corrupted"], 8, 47, 5],
    ["Arcane Energize", ["arcane_enhancement", "legendary"], 34 * 21, 140, 5],
    ["Arcane Grace", ["arcane_enhancement", "legendary"], 11 * 21, 95, 5],
    ["Arcane Guardian", ["arcane_enhancement", "rare"], 6 * 21, 110, 5],
    ["Molt Augmented", ["arcane_enhancement", "rare"], 9 * 21, 60, 5],
    ["Arcane Avenger", ["arcane_enhancement", "rare"], 7 * 21, 72, 5],
    ["Axi L4 Relic", ["relic", "axi"], 6, 120],
    ["Neo N11 Relic", ["relic", "neo"], 5, 74],
    ["Lith G1 Relic", ["relic", "lith"], 5, 88],
    ["Meso N6 Relic", ["relic", "meso"], 7, 65],
    ["Axi S3 Relic", ["relic", "axi"], 9, 51],
    ["Ayatan Anasa Sculpture", ["ayatan_sculpture"], 9, 45],
    ["Legendary Fusion Core", ["fusion_core", "legendary"], 210, 3],
    ["Scimitar Avionics", ["component", "landing_craft"], 16, 8],
    ["Kuva Bramma Riven placeholder", ["misc"], 0, 0],
    ["Octavia Prime Set", ["set", "prime", "warframe"], 88, 27],
    ["Harrow Prime Set", ["set", "prime", "warframe"], 64, 22],
    ["Gauss Prime Set", ["set", "prime", "warframe"], 96, 41],
    ["Sevagoth Prime Neuroptics Blueprint", ["component", "prime", "warframe", "blueprint"], 12, 19],
    ["Primed Reach", ["mod", "legendary", "melee"], 44, 37, 10],
    ["Rolling Guard", ["mod", "rare", "warframe"], 15, 73, 10],
    ["Arcane Strike", ["arcane_enhancement", "uncommon"], 2 * 21, 30, 5],
  ].filter((r) => r[2] > 0);
  const items = CATALOGUE.map(([name, tags, price, volume, maxRank]) => {
    const isRelic = tags.includes("relic");
    return {
      name,
      uniqueName: `/Lotus/Mock/${name.replace(/[^A-Za-z0-9]+/g, "")}`,
      wfmId: hex(24),
      wfmUrl: slug(name),
      tradeTax: tags.includes("legendary") ? 1000000 : tags.includes("set") ? 8000 : 2000,
      masteryReq: tags.includes("legendary") ? 2 : 0,
      tags,
      icon: `items/images/en/${slug(name)}.png`,
      bulkTradable: isRelic,
      ...(maxRank ? { subTypes: { maxRank } } : isRelic ? { subTypes: { variants: ["intact", "exceptional", "flawless", "radiant"] } } : {}),
      variantToUniqueName: {},
      description: `${name} (mock catalogue entry).`,
      _price: price,
      _volume: volume,
      _maxRank: maxRank || 0,
    };
  });
  const itemBy = (key) => items.find((i) => i.wfmUrl === key || i.wfmId === key || i.name === key || i.uniqueName === key);
  const publicItem = (i) => {
    const { _price, _volume, _maxRank, ...rest } = i;
    return rest;
  };
  const categoryOf = (tags) => (tags.includes("arcane_enhancement") ? "arcane" : tags.includes("mod") ? "mod" : tags.includes("relic") ? "relic" : tags.includes("set") ? "set" : tags.includes("prime") ? "prime" : "other");

  const WEAPONS = [
    ["Rubico", "rifle", 1.15, 4],
    ["Kronen", "melee", 1.3, 5],
    ["Soma", "rifle", 1.2, 4],
    ["Kuva Bramma", "rifle", 0.6, 1],
    ["Glaive", "melee", 1.25, 4],
    ["Catchmoon", "kitgun", 0.85, 2],
    ["Acceltra", "rifle", 0.8, 2],
    ["Nikana", "melee", 1.1, 3],
    ["Lex", "pistol", 1.3, 5],
    ["Ignis", "rifle", 0.95, 3],
    ["Stahlta", "rifle", 1.05, 3],
    ["Phenmor", "rifle", 0.55, 1],
  ].map(([name, type, disposition, rank]) => ({
    uniqueName: `/Lotus/Weapons/Mock/${name.replace(/\s+/g, "")}`,
    name,
    icon: `items/images/en/${slug(name)}.png`,
    wfmUrl: slug(name),
    wfmRivenUrl: slug(name),
    subType: null,
    wfmRivenId: hex(24),
    wfmId: hex(24),
    rivenType: type,
    category: type,
    source: "mock",
    family: name,
    upgradeType: `/Lotus/Upgrades/Mods/Randomized/Lotus${type}RandomModRare`,
    disposition,
    dispositionRank: rank,
    isVariant: false,
  }));
  const weaponBy = (key) => WEAPONS.find((w) => w.wfmRivenUrl === key || w.wfmUrl === key || w.name === key || w.wfmId === key || w.wfmRivenId === key);

  const ATTRS = [
    ["critical_chance", "Critical Chance", "crita", "cron", "%"],
    ["critical_damage", "Critical Damage", "acri", "tis", "%"],
    ["multishot", "Multishot", "sati", "can", "%"],
    ["base_damage_/_melee_damage", "Damage", "visi", "ata", "%"],
    ["toxin_damage", "Toxin", "toxi", "tox", "%"],
    ["fire_rate_/_attack_speed", "Fire Rate", "croni", "dra", "%"],
    ["recoil", "Weapon Recoil", "zeti", "mag", "%"],
    ["zoom", "Zoom", "hera", "lis", "%"],
    ["status_chance", "Status Chance", "hexa", "dex", "%"],
    ["impact_damage", "Impact", "magna", "ton", "%"],
    ["electric_damage", "Electricity", "vexi", "tio", "%"],
    ["range", "Range", "locti", "tor", ""],
  ].map(([url, label, prefix, suffix, unit]) => ({
    uniqueName: `WeaponMock${url}`,
    wfmId: hex(24),
    wfmUrl: url,
    url_name: url,
    formattedValue: `+{value}${unit} ${label}`,
    full: label,
    short: label,
    group: "default",
    highlightedLabel: label,
    label,
    unit: unit || undefined,
    prefix,
    suffix,
  }));
  const rivenAttr = (url, value, positive = true) => {
    const a = ATTRS.find((x) => x.wfmUrl === url);
    return { wfmUrl: url, url_name: url, positive, value, formattedValue: `${positive ? "+" : "-"}${Math.abs(value)}${a.unit || ""} ${a.label}` };
  };

  const SYNDICATES = [
    ["Steel Meridian", "#2c3f46", "#f1a37c"],
    ["Arbiters of Hexis", "#374045", "#cfe1e4"],
    ["Cephalon Suda", "#3d375d", "#fbfed0"],
    ["The Perrin Sequence", "#3d4963", "#92dbff"],
    ["Red Veil", "#3d1839", "#fe5f41"],
    ["New Loka", "#2a3c2e", "#c2ffc2"],
  ].map(([name, bg, fg]) => ({
    uniqueName: `${name.replace(/[^A-Za-z]/g, "")}Syndicate`,
    name,
    canSelect: true,
    iconColour: fg,
    backgroundColour: bg,
    titles: [0, 1, 2, 3, 4, 5].map((level) => ({ level, name: `Rank ${level}`, minStanding: level * 20000, maxStanding: (level + 1) * 20000 + 12000 })),
    favours: [],
  }));

  // ------------------------------------------------------------------------------------------
  // settings (Settings::default() in src-tauri/src/app/types/settings, plus a realistic setup)
  // ------------------------------------------------------------------------------------------
  // the real src-tauri/resources/tos.md (passed in by the runner), so the app parses the real file
  const TOS_TEXT = OPTIONS.tosText || "<ID>tos-2026-mock</ID>\n# Terms of Service (mock)\n";
  const TOS_ID = TOS_TEXT.substring(TOS_TEXT.indexOf("<ID>") + 4, TOS_TEXT.indexOf("</ID>"));
  const sysNotify = (title, content) => ({ enabled: true, title, content, sound_file: "cat_meow.mp3", volume: 1.0 });
  const notify = (title, content, discord) => ({
    system_notify: sysNotify(title, content),
    discord_notify: { enabled: true, content: discord, webhook: "", user_ids: [] },
    webhook_notify: { enabled: false, url: "<WEBHOOK_URL>" },
  });
  const defaultNotifications = () => ({
    custom_sounds: [],
    on_new_conversation: notify("New Conversation", "From: <PLAYER_NAME>", "<MENTION>\n```ansi\nNew Conversation\nFrom Player: <PLAYER_NAME>\n```"),
    on_wfm_chat_message: notify("New Warframe Market Message", "Chat Name: <CHAT_NAME> | From: <FROM_USER> | Message: \n <WFM_MESSAGE>", "<MENTION>\n```ansi\nNew Warframe Market Message\n<WFM_MESSAGE>\n```"),
    on_new_trade: notify("Item <TR_TYPE>", "From: <PLAYER_NAME>\nOffered: <OF_COUNT> Received: <RE_COUNT> Plat: <TOTAL_PLAT>", "<MENTION>\n```ansi\nPlayer Trade\n<PLAYER_NAME>\n```"),
  });
  const defaultSettings = () => ({
    lang: "en",
    live_scraper: {
      general: { report_to_wfm: true, auto_delete: true, auto_trade: true, stock_mode: "all", trade_modes: ["buy", "sell", "wishlist"], delete_conflicting_orders: false },
      items: {
        general: { blacklist: [], buy_list: [] },
        wtb: {
          volume_threshold: 15,
          profit_threshold: 10,
          avg_price_cap: 600,
          trading_tax_cap: -1,
          max_total_price_cap: 100000,
          price_shift_threshold: -1,
          buy_quantity: 1,
          min_wtb_profit_margin: -1,
          quantity_per_trade: 1,
          max_stock_quantity: -1,
          max_price_drop: -1,
          min_listings_below: -1,
          outbid_step: 1,
          min_roi_percentage: 15,
        },
        wts: { min_sma: 3, min_profit: 10, min_profit_percentage: -1, max_price_drop: -1, min_listings_below: -1, undercut_step: 1, stale_after_days: 5, stale_decay_percentage: 20, stale_floor_profit: 2 },
      },
      rivens: { general: { update_interval: 120 }, wts: { min_profit: 25, threshold_percentage: 15.0, max_results: 5, use_predict: false, auto_match_stats: true, min_comparables: 3, undercut_step: 1 } },
      syndicate: { wts: { syndicates: [], volume_threshold: 10, min_price: 10, max_price_drop: -1, min_listings_below: -1 } },
      void_trader: { preset: "scavenger", smart_enabled: true, strict_tiers: true, locked_fields: [], manual_platinum: null },
    },
    summary_settings: {
      recent_days: 7,
      recent_transactions: 10,
      categories: [
        { icon: "/imgs/categories/mods.png", name: "Mod", types: [], tags: ["mod"] },
        { icon: "/imgs/categories/arcane.png", name: "Arcane", types: [], tags: ["arcane_enhancement"] },
        { icon: "/imgs/categories/set.png", name: "Set", types: [], tags: ["set"] },
        { icon: "/imgs/categories/prime.png", name: "Prime", types: [], tags: ["prime"] },
        { icon: "/imgs/categories/axi-intact.png", name: "Relic", types: [], tags: ["relic"] },
        { icon: "/imgs/categories/rivenIcon2.png", name: "Riven", types: ["riven"], tags: [] },
      ],
    },
    advanced_settings: { http_server: { enable: false, host: "127.0.0.1", port: 4808 } },
    log_settings: { ee_log_path: "" },
    notifications: defaultNotifications(),
    generate_trade_message: {
      templates: [
        {
          name: "Default",
          prefix: "WTS ",
          suffix: " :heart:",
          template: "[<link>] <type><variant><rank><amber_stars><cyan_stars><price> ",
          group_by_key: "",
          displaySettings: { rank: { prefix: "R ", suffix: "" }, price: { prefix: "", suffix: "p" } },
        },
      ],
    },
    tos_uuid: "",
    wf_inventory: { source: "None" },
    debugging: { live_scraper: { entries: [], fake_orders: false } },
  });

  // ------------------------------------------------------------------------------------------
  // state
  // ------------------------------------------------------------------------------------------
  const state = {
    started: OPTIONS.started,
    settings: defaultSettings(),
    user: null,
    running: false,
    platinum: OPTIONS.platinum,
    masteryRank: 16,
    tradesRemaining: 14,
    inventoryConnected: OPTIONS.inventory === "connected",
    stockItems: [],
    stockRivens: [],
    wishList: [],
    syndicateItems: [],
    transactions: [],
    tradeEntries: [],
    chats: [],
    activeChat: null,
    orders: [],
    auctions: [],
    alerts: [],
    owned: [],
    invRivens: [],
    rivenPrices: [],
    rivenScan: { running: false, done: 0, total: 0, current: "", started_at: null, last_completed: iso(NOW - 3 * 3600000), last_error: null },
    adjustments: [],
    customSounds: [],
    themes: [],
    clipboard: "",
    opened: [],
    nextId: 1000,
  };
  state.settings.tos_uuid = OPTIONS.tosAccepted ? TOS_ID : "";
  state.settings.wf_inventory.source = OPTIONS.inventory === "none" ? "None" : { Alecaframe: { path: "" } };

  const loggedInUser = () => ({
    anonymous: false,
    verification: true,
    wfm_banned: false,
    qf_banned: false,
    wfm_id: "5f0a1b2c3d4e5f6a7b8c9d0e",
    wfm_token: "mock-wfm-token",
    qf_token: "mock-qf-token",
    wfm_avatar: "user/avatar/mock.png",
    wfm_username: "VoidTraderTester",
    check_code: "mockcheck",
    locale: "en",
    platform: "pc",
    wfm_status: "ingame",
    unread_messages: 2,
    permissions: "all",
  });
  const anonymousUser = () => ({ anonymous: true, verification: false, wfm_banned: false, qf_banned: false, wfm_id: "", wfm_token: "", qf_token: "", wfm_username: "", check_code: "", locale: "en", platform: "pc", wfm_status: "invisible", unread_messages: 0 });
  state.user = OPTIONS.loggedIn ? loggedInUser() : anonymousUser();

  // --- stock items: 12, every interesting status; some rows have no `properties` key at all,
  //     exactly like the backend (Properties is skipped when empty).
  const stockRow = (name, owned, bought, list, status, opts = {}) => {
    const it = itemBy(name);
    const created = NOW - int(1, 20) * DAY;
    const row = {
      id: state.nextId++,
      wfm_id: it.wfmId,
      wfm_url: it.wfmUrl,
      item_name: it.name,
      item_unique_name: it.uniqueName,
      ...(opts.sub_type ? { sub_type: opts.sub_type } : {}),
      bought,
      ...(list != null ? { list_price: list } : {}),
      owned,
      is_hidden: Boolean(opts.hidden),
      status,
      price_history: list != null ? [{ created_at: iso(created + DAY), price: list + 4 }, { created_at: iso(created + 2 * DAY), price: list }] : [],
      updated_at: iso(NOW - int(0, 5) * 3600000),
      created_at: iso(created),
      is_dirty: false,
      locked: false,
      changes: [],
      ...(opts.properties ? { properties: opts.properties } : {}),
    };
    return row;
  };
  state.stockItems = [
    stockRow("Glaive Prime Set", 1, 110, 165, "live"),
    stockRow("Nova Prime Set", 2, 48, 78, "live"),
    stockRow("Kronen Prime Set", 1, 60, 92, "live", { properties: { min_price: 80 } }),
    stockRow("Mesa Prime Systems Blueprint", 1, 0, 55, "live"),
    stockRow("Primed Continuity", 1, 40, 62, "pending", { sub_type: { rank: 10 } }),
    stockRow("Arcane Energize", 3, 20, 34, "live", { sub_type: { rank: 0 }, properties: { is_bulk: true } }),
    stockRow("Blind Rage", 4, 6, 12, "to_low_profit", { sub_type: { rank: 0 }, properties: { min_profit: 3, min_sma: 2 } }),
    stockRow("Rhino Prime Chassis Blueprint", 1, 12, 22, "order_limit"),
    stockRow("Maiming Strike", 1, 30, 48, "overpriced", { sub_type: { rank: 0 } }),
    stockRow("Narrow Minded", 2, 9, null, "no_sellers", { sub_type: { rank: 0 } }),
    stockRow("Vigilante Armaments", 27, 1, null, "inactive", { hidden: true, sub_type: { rank: 0 } }),
    stockRow("Legendary Fusion Core", 1, 150, 210, "sma_limit"),
  ];

  const rivenRow = (weapon, modName, bought, list, status, mr, rolls, attrs, opts = {}) => {
    const w = weaponBy(weapon);
    return {
      id: state.nextId++,
      wfm_weapon_id: w.wfmRivenId,
      wfm_weapon_url: w.wfmRivenUrl,
      weapon_name: w.name,
      weapon_type: w.rivenType,
      weapon_unique_name: w.uniqueName,
      sub_type: { rank: 8 },
      mod_name: modName,
      attributes: attrs,
      mastery_rank: mr,
      re_rolls: rolls,
      polarity: opts.polarity || "madurai",
      bought,
      ...(list != null ? { list_price: list } : {}),
      filter: opts.filter || { enabled: false },
      is_hidden: false,
      comment: "",
      status,
      uuid: hex(32),
      price_history: [],
      updated_at: iso(NOW - int(0, 30) * 3600000),
      created_at: iso(NOW - int(3, 40) * DAY),
      is_dirty: false,
      locked: false,
      ...(opts.properties ? { properties: opts.properties } : {}),
    };
  };
  state.stockRivens = [
    rivenRow("Rubico", "Critacan", 320, 450, "live", 12, 8, [rivenAttr("critical_chance", 138.2), rivenAttr("multishot", 97.4), rivenAttr("zoom", 44.1, false)], { properties: { min_price: 380 } }),
    rivenRow("Kronen", "Visi-toxitis", 90, 140, "live", 9, 3, [rivenAttr("base_damage_/_melee_damage", 172.5), rivenAttr("toxin_damage", 88.3), rivenAttr("critical_damage", 91.0)], { polarity: "naramon" }),
    rivenRow("Soma", "Argi-satitron", 60, null, "pending", 10, 0, [rivenAttr("critical_damage", 101.3), rivenAttr("multishot", 88.8), rivenAttr("impact_damage", 60.2, false)], { polarity: "vazarin" }),
  ];

  const wishRow = (name, quantity, max, list, status, opts = {}) => {
    const it = itemBy(name);
    return {
      id: state.nextId++,
      wfm_id: it.wfmId,
      wfm_url: it.wfmUrl,
      item_name: it.name,
      item_unique_name: it.uniqueName,
      ...(opts.sub_type ? { sub_type: opts.sub_type } : {}),
      quantity,
      ...(list != null ? { list_price: list } : {}),
      price_history: [],
      status,
      updated_at: iso(NOW - int(0, 30) * 3600000),
      created_at: iso(NOW - int(1, 20) * DAY),
      is_hidden: false,
      is_dirty: false,
      locked: false,
      changes: [],
      ...(max != null ? { properties: { max_price: max } } : {}),
    };
  };
  state.wishList = [
    wishRow("Primed Flow", 1, 70, 64, "live", { sub_type: { rank: 10 } }),
    wishRow("Arcane Grace", 2, 18, null, "no_sellers", { sub_type: { rank: 0 } }),
    wishRow("Wisp Prime Set", 1, 120, 104, "live"),
    wishRow("Adaptation", 1, null, null, "pending", { sub_type: { rank: 0 } }),
  ];

  // --- transactions: 329 trades across ~8 months, a couple of sales today
  const BUYERS = ["StarHollow", "VoidRunner77", "xX_Nimbus_Xx", "Kestrel_9", "TradeKat", "PlatBaron", "QuietLantern", "Mirelle.Vant", "IronPathSam", "Ashfall42", "Orren_Vask", "NightwaveNora"];
  const tradable = items.filter((i) => i._price >= 5);
  const makeTransaction = (at, type, forced) => {
    const riven = !forced && rnd() < 0.06;
    const it = forced || pick(tradable);
    const w = pick(WEAPONS);
    const qty = riven ? 1 : rnd() < 0.15 ? int(2, 4) : 1;
    const unit = riven ? int(40, 600) : Math.max(1, Math.round(it._price * (type === "sale" ? 1 : 0.7) * (0.8 + rnd() * 0.4)));
    const price = unit * qty;
    const profit = type === "sale" ? Math.round(price * (0.15 + rnd() * 0.35)) : 0;
    return {
      id: state.nextId++,
      wfm_id: riven ? w.wfmRivenId : it.wfmId,
      wfm_url: riven ? w.wfmRivenUrl : it.wfmUrl,
      item_name: riven ? `${w.name} ${pick(["Critacan", "Visi-toxitis", "Argi-satitron", "Croni-hexacan"])}` : it.name,
      item_type: riven ? "riven" : "item",
      item_unique_name: riven ? w.uniqueName : it.uniqueName,
      ...(riven ? { sub_type: { rank: 8 } } : it._maxRank ? { sub_type: { rank: rnd() < 0.5 ? 0 : it._maxRank } } : {}),
      tags: riven ? "riven,weapon" : it.tags.join(","),
      transaction_type: type,
      quantity: qty,
      user_name: pick(BUYERS),
      price,
      profit: type === "sale" ? profit : rnd() < 0.5 ? null : 0,
      credits: 0,
      updated_at: iso(at),
      created_at: iso(at),
      properties: riven ? { mod_name: "Critacan", mastery_rank: 12, re_rolls: 4, polarity: "madurai", attributes: [rivenAttr("critical_chance", 120.1), rivenAttr("multishot", 80.2)] } : null,
    };
  };
  for (let i = 0; i < 325; i++) {
    const age = Math.pow(rnd(), 1.6) * 240 * DAY + 2 * 3600000 + DAY;
    state.transactions.push(makeTransaction(NOW - age, rnd() < 0.62 ? "sale" : "purchase"));
  }
  // today (kept safely inside the current UTC day)
  const startOfUtcDay = Math.floor(NOW / DAY) * DAY;
  const todayAt = (i) => Math.min(NOW - 60000 * (i + 1), startOfUtcDay + (NOW - startOfUtcDay) * (0.2 + 0.2 * i));
  state.transactions.push(makeTransaction(todayAt(0), "sale", itemBy("Nova Prime Set")));
  state.transactions.push(makeTransaction(todayAt(1), "sale", itemBy("Primed Continuity")));
  state.transactions.push(makeTransaction(todayAt(2), "purchase", itemBy("Glaive Prime Blade")));
  state.transactions.push(makeTransaction(todayAt(3), "sale", itemBy("Blind Rage")));
  state.transactions.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // --- trade entries (Trade Messages page)
  const tradeEntry = (name, price, group, opts = {}) => {
    const it = itemBy(name);
    return {
      id: state.nextId++,
      wfm_id: it ? it.wfmId : "",
      name,
      ...(opts.sub_type ? { sub_type: opts.sub_type } : {}),
      price,
      group,
      tags: it ? it.tags.join(",") : opts.tags || "",
      updated_at: iso(NOW - int(0, 90) * 3600000),
      created_at: iso(NOW - int(5, 30) * DAY),
      properties: opts.properties || (it ? { wfm_url: it.wfmUrl, unique_name: it.uniqueName } : {}),
    };
  };
  state.tradeEntries = [
    tradeEntry("Glaive Prime Set", 165, "item"),
    tradeEntry("Nova Prime Set", 78, "item"),
    tradeEntry("Primed Continuity", 62, "item", { sub_type: { rank: 10 } }),
    tradeEntry("Arcane Energize", 700, "item", { sub_type: { rank: 5 } }),
    tradeEntry("Mesa Prime Set", 140, "item"),
    tradeEntry("Axi L4 Relic", 6, "item", { sub_type: { variant: "intact" } }),
    tradeEntry("Carry service: Steel Path Arbitration", 25, "custom", { tags: "custom", properties: {} }),
    tradeEntry("Rubico Critacan", 450, "riven", { tags: "riven", properties: { wfm_url: "rubico", mod_name: "Critacan", mastery_rank: 12, re_rolls: 8, polarity: "madurai", attributes: [rivenAttr("critical_chance", 138.2), rivenAttr("multishot", 97.4), rivenAttr("zoom", 44.1, false)] } }),
  ];

  // --- chats
  const chatUser = (name, reputation, status) => ({ id: hex(24), ingame_name: name, reputation, avatar: null, status });
  const makeChat = (name, reputation, status, lines, unread, hoursAgo) => {
    const other = chatUser(name, reputation, status);
    const id = hex(24);
    const start = NOW - hoursAgo * 3600000;
    const messages = lines.map(([mine, text], i) => ({ id: hex(24), message: text, raw_message: text, chat_id: id, send_date: iso(start + i * 90000), message_from: mine ? state.user.wfm_id || "me" : other.id }));
    return { id, chat_with: [other], unread_count: unread, chat_name: name, messages, last_update: iso(start + lines.length * 90000) };
  };
  state.chats = [
    makeChat("StarHollow", 14, "ingame", [[false, 'Hi! I want to buy: "Glaive Prime Set" for 165 platinum. (warframe.market)'], [true, "Sure, inviting you now."], [false, "ty!"]], 0, 30),
    makeChat("VoidRunner77", 3, "online", [[false, 'Hi! I want to buy: "Primed Continuity" (rank 10) for 60 platinum. (warframe.market)'], [false, "still available?"]], 2, 2),
    makeChat("PlatBaron", 51, "ingame", [[false, "still selling the Rubico riven? can do 400p"], [true, "450 is the lowest I can go."], [false, "ok 430?"], [true, "deal"]], 0, 55),
    makeChat("TradeKat", 0, "invisible", [[true, 'Hi! I want to sell: "Wisp Prime Set" for 104 platinum. (warframe.market)']], 0, 80),
    makeChat("Kestrel_9", 7, "online", [[false, "grakata?"], [true, "Grakata!"]], 0, 200),
  ];

  // --- warframe.market orders and auctions
  const makeOrder = (name, type, platinum, quantity, opts = {}) => {
    const it = itemBy(name);
    const created = NOW - int(1, 15) * DAY;
    return {
      id: hex(24),
      type,
      platinum,
      quantity,
      perTrade: 1,
      per_trade: 1,
      rank: opts.rank ?? null,
      ...(opts.rank != null ? { rank: opts.rank } : {}),
      subtype: opts.subtype ?? null,
      visible: opts.visible ?? true,
      createdAt: iso(created),
      updatedAt: iso(created + 3600000 * int(1, 20)),
      itemId: it.wfmId,
      user: { id: state.user.wfm_id, ingame_name: state.user.wfm_username, reputation: 21, avatar: state.user.wfm_avatar, status: "ingame" },
      properties: {
        item_name: it.name,
        name: it.name,
        wfm_url: it.wfmUrl,
        wfm_id: it.wfmId,
        image_url: it.icon,
        item_unique_name: it.uniqueName,
        tags: it.tags,
        trade_tax: it.tradeTax,
        closed_avg: it._price,
        highest_price: Math.round(it._price * 1.2),
        lowest_price: Math.round(it._price * 0.9),
        profit: type === "sell" ? Math.round(platinum * 0.3) : 0,
        potential_profit: Math.round(platinum * 0.3),
        operations: [],
        can_handle: true,
      },
    };
  };
  state.orders = [
    makeOrder("Glaive Prime Set", "sell", 165, 1),
    makeOrder("Nova Prime Set", "sell", 78, 2),
    makeOrder("Kronen Prime Set", "sell", 92, 1),
    makeOrder("Mesa Prime Systems Blueprint", "sell", 55, 1),
    makeOrder("Arcane Energize", "sell", 34, 3, { rank: 0 }),
    makeOrder("Blind Rage", "sell", 12, 4, { rank: 0 }),
    makeOrder("Rhino Prime Chassis Blueprint", "sell", 22, 1),
    makeOrder("Maiming Strike", "sell", 48, 1, { rank: 0 }),
    makeOrder("Legendary Fusion Core", "sell", 210, 1),
    makeOrder("Primed Flow", "buy", 64, 1, { rank: 10 }),
    makeOrder("Wisp Prime Set", "buy", 104, 1),
    makeOrder("Octavia Prime Set", "buy", 70, 1),
    makeOrder("Axi L4 Relic", "sell", 6, 14, { subtype: "intact" }),
    makeOrder("Gauss Prime Set", "sell", 96, 1, { visible: false }),
  ];
  const makeAuction = (riven) => ({
    id: hex(24),
    uuid: riven.uuid,
    buyout_price: riven.list_price ?? 300,
    starting_price: riven.list_price ?? 300,
    closed: false,
    created: iso(NOW - 4 * DAY),
    updated: iso(NOW - 3600000),
    is_direct_sell: true,
    is_marked_for: null,
    marked_operation_at: null,
    minimal_reputation: 0,
    note: "",
    note_raw: "",
    platform: "pc",
    private: false,
    visible: true,
    top_bid: null,
    winner: null,
    owner: { id: state.user.wfm_id, ingame_name: state.user.wfm_username, reputation: 21, avatar: state.user.wfm_avatar, status: "ingame" },
    item: {
      type: "riven",
      name: riven.mod_name,
      weapon_url_name: riven.wfm_weapon_url,
      attributes: riven.attributes.map((a) => ({ ...a, url_name: a.wfmUrl })),
      mastery_level: riven.mastery_rank,
      mod_rank: 8,
      polarity: riven.polarity,
      re_rolls: riven.re_rolls,
      similarity: { extra: [], missing: [], score: 1 },
    },
    properties: { item_name: `${riven.weapon_name} ${riven.mod_name}`, weapon_name: riven.weapon_name, image_url: `items/images/en/${riven.wfm_weapon_url}.png`, can_import: false, operations: [], stock_id: riven.id },
  });
  state.auctions = state.stockRivens.filter((r) => r.list_price).map(makeAuction);
  state.auctions.push({
    ...makeAuction(rivenRow("Lex", "Hexa-dexitis", 0, 75, "live", 8, 1, [rivenAttr("status_chance", 110.0), rivenAttr("fire_rate_/_attack_speed", 60.5)])),
    properties: { item_name: "Lex Hexa-dexitis", weapon_name: "Lex", image_url: "items/images/en/lex.png", can_import: true, operations: ["Import"] },
  });

  state.alerts = [
    { id: hex(24), created_at: iso(NOW - 2 * DAY), updated_at: iso(NOW - 2 * DAY), type: "info", context: "Mock alert: Void Trader 1.12 is out. Read the notes.", enabled: true, properties: { event: "open_url", payload: "https://example.invalid/notes" } },
    { id: hex(24), created_at: iso(NOW - DAY), updated_at: iso(NOW - DAY), type: "warning", context: "Mock alert: warframe.market maintenance on Friday.", enabled: true, properties: null },
  ];
  if (!OPTIONS.alerts) state.alerts = [];

  // --- owned inventory for the sell finder: ~46 priced item types
  state.owned = items
    .filter((i) => i._price > 0)
    .slice(0, 46)
    .map((i) => ({ item: i, quantity: categoryOf(i.tags) === "relic" ? int(4, 30) : categoryOf(i.tags) === "mod" ? int(1, 6) : categoryOf(i.tags) === "arcane" ? int(2, 11) : int(1, 3) }));
  state.invRivens = [
    { weapon: "Catchmoon", mod: "Sati-locticron", mr: 11, rolls: 2, attrs: [rivenAttr("multishot", 80.1), rivenAttr("range", 2.1), rivenAttr("critical_damage", 70.4)], price: 85, grade: "good" },
    { weapon: "Acceltra", mod: "Crita-vexitis", mr: 14, rolls: 9, attrs: [rivenAttr("critical_chance", 90.3), rivenAttr("electric_damage", 61.0)], price: 240, grade: "perfect" },
    { weapon: "Ignis", mod: "Toxi-hexanak", mr: 8, rolls: 0, attrs: [rivenAttr("toxin_damage", 95.5), rivenAttr("status_chance", 72.1), rivenAttr("recoil", 40.0, false)], price: 35, grade: "decisive" },
    { weapon: "Rubico", mod: "Critacan", mr: 12, rolls: 8, attrs: state.stockRivens[0].attributes, price: 450, grade: "perfect", uuid: state.stockRivens[0].uuid },
  ].map((r) => {
    const w = weaponBy(r.weapon);
    return {
      attributes: r.attrs,
      mastery_rank: r.mr,
      mod_name: r.mod,
      name: w.name,
      polarity: "madurai",
      re_rolls: r.rolls,
      // inventory rivens are "veiled" (identified), "unveiled" (challenge running) or "pre-veiled"
      riven_type: "veiled",
      sub_type: { rank: 8 },
      unique_name: w.uniqueName,
      uuid: r.uuid || hex(32),
      wfm_url: w.wfmRivenUrl,
      quantity: 1,
      properties: { is_in_stock: false, challenge_description: "", challenge_description_with_complication: "", grade: r.grade, price: r.price, image_url: w.icon, weapon_name: w.name },
    };
  });

  state.rivenPrices = WEAPONS.map((w) => {
    const base = Math.round(40 + rnd() * 500);
    return { wfm_id: w.wfmRivenId, uuid: hex(32), wfm_url: w.wfmRivenUrl, name: w.name, volume: Math.round(rnd() * 60 * 10) / 10, min_price: Math.round(base * 0.3), max_price: base * 6, avg_price: Math.round(base * 1.4 * 10) / 10, median_price: base, datetime: iso(NOW - int(1, 20) * 3600000) };
  });

  // ------------------------------------------------------------------------------------------
  // derived data
  // ------------------------------------------------------------------------------------------
  const sortRows = (rows, by, dir) => {
    if (!by) return rows;
    const m = dir === "desc" ? -1 : 1;
    const get = (r) => {
      let v = r;
      for (const part of String(by).split(".")) v = v == null ? v : v[part];
      return v;
    };
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * m;
    });
  };
  const paginate = (rows, q) => {
    q = q || {};
    const page = Math.max(1, Number(q.page ?? q.pagination?.page ?? 1) || 1);
    const limit = Number(q.limit ?? q.pagination?.limit ?? 25);
    const total = rows.length;
    const results = limit < 0 ? rows : rows.slice((page - 1) * limit, page * limit);
    return { total, limit, page, total_pages: limit > 0 ? Math.ceil(total / limit) : 1, results: clone(results) };
  };
  const textMatch = (q, ...fields) => {
    const s = String(q || "").trim().toLowerCase();
    return !s || fields.some((f) => String(f || "").toLowerCase().includes(s));
  };
  const listQuery = (rows, q, fields) => {
    q = q || {};
    let out = rows.filter((r) => textMatch(q.query, ...fields(r)));
    if (q.status) out = out.filter((r) => r.status === q.status);
    return sortRows(out, q.sort_by, q.sort_direction);
  };
  const statusCounts = (rows) => {
    const out = {};
    for (const r of rows) out[r.status] = (out[r.status] || 0) + 1;
    return out;
  };

  /** FinancialReport::from(&transactions) */
  const financialReport = (txs, properties) => {
    const sales = txs.filter((t) => t.transaction_type === "sale");
    const purchases = txs.filter((t) => t.transaction_type === "purchase");
    const revenue = sales.reduce((s, t) => s + t.price, 0);
    const expenses = purchases.reduce((s, t) => s + t.price, 0);
    const profit = revenue - expenses;
    const max = (a) => (a.length ? Math.max(...a) : 0);
    const min = (a) => (a.length ? Math.min(...a) : 0);
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      total_transactions: txs.length,
      average_transaction: txs.length ? r2((revenue + expenses) / txs.length) : 0,
      total_profit: profit,
      average_profit: sales.length ? r2(profit / sales.length) : 0,
      profit_margin: revenue ? r2((profit / revenue) * 100) : 0,
      roi: expenses ? r2((profit / expenses) * 100) : 0,
      sale_count: sales.length,
      highest_revenue: max(sales.map((t) => t.price)),
      lowest_revenue: min(sales.map((t) => t.price)),
      average_revenue: sales.length ? r2(revenue / sales.length) : 0,
      revenue,
      purchases_count: purchases.length,
      highest_expense: max(purchases.map((t) => t.price)),
      lowest_expense: min(purchases.map((t) => t.price)),
      average_expense: purchases.length ? r2(expenses / purchases.length) : 0,
      expenses,
      ...(properties ? { properties } : {}),
    };
  };
  const pad = (n) => String(n).padStart(2, "0");
  const dashboard = () => {
    const txs = state.transactions;
    const now = new Date();
    const yearChart = (year) => {
      const labels = [];
      const values = [];
      for (let m = 0; m < 12; m++) {
        labels.push(`${year}-${pad(m + 1)}`);
        values.push(financialReport(txs.filter((t) => new Date(t.created_at).getUTCFullYear() === year && new Date(t.created_at).getUTCMonth() === m)).total_profit);
      }
      return { labels, values };
    };
    const yearOf = (y) => txs.filter((t) => new Date(t.created_at).getUTCFullYear() === y);
    const day = (t) => t.created_at.slice(0, 10);
    const today = iso(now).slice(0, 10);
    const todayTx = txs.filter((t) => day(t) === today);
    const hours = { labels: [], values: [] };
    for (let h = 0; h < 24; h++) {
      hours.labels.push(`${pad(h)}:00`);
      hours.values.push(financialReport(todayTx.filter((t) => new Date(t.created_at).getUTCHours() === h)).total_profit);
    }
    const days = state.settings.summary_settings.recent_days;
    const recent = { labels: [], values: [] };
    const recentTx = [];
    for (let d = days; d >= 0; d--) {
      const key = iso(NOW - d * DAY).slice(0, 10);
      const list = txs.filter((t) => day(t) === key);
      recentTx.push(...list);
      recent.labels.push(key);
      recent.values.push(financialReport(list).total_profit);
    }
    const byItem = {};
    for (const t of txs) (byItem[t.wfm_id] ||= []).push(t);
    let best = financialReport([], { wfm_id: "N/A", item_name: "N/A", item_type: "N/A" });
    for (const group of Object.values(byItem)) {
      const rep = financialReport(group, { wfm_id: group[0].wfm_id, item_name: group[0].item_name, item_type: group[0].item_type });
      if (rep.total_profit > best.total_profit) best = rep;
    }
    const y = now.getUTCFullYear();
    return {
      total: { ...financialReport(txs), present_year: { summary: financialReport(yearOf(y)), chart: yearChart(y) }, last_year: { summary: financialReport(yearOf(y - 1)), chart: yearChart(y - 1) } },
      today: { summary: financialReport(todayTx), chart: hours },
      recent_days: { summary: financialReport(recentTx), chart: recent },
      best_seller: best,
      categories: state.settings.summary_settings.categories.map((c) => financialReport(txs.filter((t) => t.tags.split(",").some((tag) => c.tags.includes(tag.trim())) || c.types.includes(t.item_type)), { icon: c.icon, name: c.name })),
      resent_transactions: clone(txs.slice(0, state.settings.summary_settings.recent_transactions)),
    };
  };

  // --- void trader: sell finder, plat goal, strategy (mirrors commands/void_sell_finder.rs, void_strategy.rs)
  const GOAL_LADDER = [150, 300, 600, 1200, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000];
  const balanceIsLive = () => state.inventoryConnected && state.settings.wf_inventory.source !== "None";
  const manualPlat = () => state.settings.live_scraper.void_trader.manual_platinum;
  const balance = () => (balanceIsLive() ? state.platinum : Math.max(0, manualPlat() ?? 0));
  const platGoal = () => {
    const today = iso(NOW).slice(0, 10);
    let week = 0;
    let profitToday = 0;
    for (const t of state.transactions) {
      const p = t.profit || 0;
      if (new Date(t.created_at).getTime() >= Date.now() - 7 * DAY) week += p;
      if (t.created_at.slice(0, 10) === today) profitToday += p;
    }
    const avg = week / 7;
    const platinum = balance();
    const reach = platinum + Math.trunc(Math.max(0, avg) * 3);
    const goal = GOAL_LADDER.find((g) => g > platinum && g >= reach) ?? (Math.floor(platinum / 1000000) + 1) * 1000000;
    const floor = Math.max(0, ...GOAL_LADDER.filter((g) => g <= platinum));
    const stretch = Math.ceil(Math.max(0, avg) * 1.25);
    const pace = Math.ceil(Math.max(0, goal - platinum) / 4);
    return {
      platinum,
      floor,
      goal,
      progress: goal > floor ? Math.min(1, Math.max(0, (platinum - floor) / (goal - floor))) : 0,
      daily_target: Math.max(stretch, Math.min(pace, Math.max(stretch, 10) * 3), 10),
      avg_daily_profit: Math.round(avg * 10) / 10,
      profit_today: profitToday,
      balance_is_live: balanceIsLive(),
      balance_known: balanceIsLive() || manualPlat() != null,
    };
  };
  const sellFinder = (minPrice) => {
    if (!balanceIsLive()) return { connected: false, platinum: 0, trades_remaining: 0, mastery_rank: 0, owned_tradable: 0, unpriced: 0, total_value: 0, items: [] };
    const stocked = new Set(state.stockItems.map((s) => s.wfm_url));
    const rows = [];
    let total = 0;
    for (const { item, quantity } of state.owned) {
      const category = categoryOf(item.tags);
      let unit = item._price;
      let basis = "exact";
      let sub_type = item.subTypes?.variants ? { variant: "intact" } : null;
      if (category === "arcane" && item._maxRank > 0) {
        unit = Math.floor(item._price / (((item._maxRank + 1) * (item._maxRank + 2)) / 2));
        basis = "arcane_estimate";
        sub_type = { rank: 0 };
      } else if (category === "mod" && item._maxRank > 0) {
        basis = "max_rank";
        sub_type = { rank: 0 };
      }
      if (unit < (minPrice ?? 0)) continue;
      const row = { name: item.name, wfm_url: item.wfmUrl, unique_name: item.uniqueName, icon: item.icon, category, quantity, unit_price: unit, total: unit * quantity, volume: item._volume, week_price_shift: Math.round((rnd() * 20 - 10) * 10) / 10, basis, sub_type, in_stock: stocked.has(item.wfmUrl) };
      if (basis !== "max_rank") total += row.total;
      rows.push(row);
    }
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { connected: true, platinum: state.platinum, trades_remaining: state.tradesRemaining, mastery_rank: state.masteryRank, owned_tradable: state.owned.length + 9, unpriced: 9, total_value: total, items: rows };
  };

  const PRESETS = {
    scavenger: { label: "Scavenger", need: 0, description: "Almost no buying: one cheap, fast-selling item at a time. Sells with a 1p undercut.", v: [true, false, 40, 5, 15, 60, 1, 1, 1, 20, 5, null, 1, 5, 20, 2, 25, true, 3, 1] },
    flipper: { label: "Flipper", need: 300, description: "Quick flips up to 60p with at least 15% return. Stock that sits 5 days gets cheaper.", v: [true, false, 20, 8, 60, 600, 2, 3, 1, 15, 10, null, 1, 5, 20, 2, 25, true, 3, 1] },
    high_roller: { label: "High Roller", need: 1500, description: "Items up to 400p, at least 20p profit, and holds its price for 10 days.", v: [true, false, 10, 20, 400, 3000, 2, 4, 1, 10, 20, null, 1, 10, 10, 5, 40, true, 3, 1] },
    riven_hunter: { label: "Riven Hunter", need: 1000, description: "Rivens first: higher riven profit with stat matching, small item buys on the side.", v: [true, true, 25, 10, 60, 300, 1, 2, 1, 15, 10, null, 1, 5, 20, 2, 60, true, 5, 1] },
    liquidate: { label: "Liquidate", need: 0, description: "No buying. Sells everything with a 3p undercut, break-even allowed.", v: [false, false, 40, 10, 0, 0, 1, 1, 0, 15, 0, -1, 3, 0, 100, 0, 0, true, 3, 3] },
  };
  const PRESET_ORDER = ["scavenger", "flipper", "high_roller", "riven_hunter", "liquidate"];
  const PRESET_KEYS = ["buy_enabled", "include_rivens", "wtb_volume_threshold", "wtb_profit_threshold", "wtb_avg_price_cap", "wtb_max_total_price_cap", "wtb_buy_quantity", "wtb_max_stock_quantity", "wtb_outbid_step", "wtb_min_roi_percentage", "wts_min_profit", "wts_min_profit_percentage", "wts_undercut_step", "wts_stale_after_days", "wts_stale_decay_percentage", "wts_stale_floor_profit", "riven_min_profit", "riven_auto_match_stats", "riven_min_comparables", "riven_undercut_step"];
  const presetValues = (id) => Object.fromEntries(PRESET_KEYS.map((k, i) => [k, PRESETS[id].v[i]]));
  const MANAGED_FIELDS = ["general.trade_modes", "general.stock_mode", "items.wtb.volume_threshold", "items.wtb.profit_threshold", "items.wtb.avg_price_cap", "items.wtb.max_total_price_cap", "items.wtb.buy_quantity", "items.wtb.max_stock_quantity", "items.wtb.outbid_step", "items.wtb.min_roi_percentage", "items.wts.min_profit", "items.wts.min_profit_percentage", "items.wts.undercut_step", "items.wts.stale_after_days", "items.wts.stale_decay_percentage", "items.wts.stale_floor_profit", "rivens.wts.min_profit", "rivens.wts.auto_match_stats", "rivens.wts.min_comparables", "rivens.wts.undercut_step"];
  const stockValue = () => state.stockItems.reduce((s, i) => s + i.bought * i.owned, 0) + state.stockRivens.reduce((s, r) => s + r.bought, 0);
  const netWorth = () => balance() + stockValue();
  const tierFor = (n) => (n >= 1500 ? "high_roller" : n >= 1000 ? "riven_hunter" : n >= 300 ? "flipper" : "scavenger");
  const strategyStatus = () => {
    const vt = state.settings.live_scraper.void_trader;
    const net = netWorth();
    const trades = balanceIsLive() ? state.tradesRemaining : null;
    // one smart adjustment when trades are running low, like the real smart trader
    const active = [];
    if (vt.smart_enabled && trades != null && trades <= 20 && !vt.locked_fields.includes("items.wtb.buy_quantity"))
      active.push({ time: iso(NOW - 40 * 60000), field: "items.wtb.buy_quantity", from: String(presetValues(vt.preset).wtb_buy_quantity), to: "1", reason: `Only ${trades} trades left today: buying one at a time.` });
    const pv = presetValues(vt.preset);
    return {
      preset: vt.preset,
      effective_preset: vt.preset,
      tier: tierFor(net),
      net_worth: net,
      platinum: balance(),
      balance_is_live: balanceIsLive(),
      stock_value: stockValue(),
      trades_remaining: trades,
      allowed_presets: vt.strict_tiers ? PRESET_ORDER.filter((p) => net >= PRESETS[p].need) : PRESET_ORDER,
      presets: PRESET_ORDER.map((id) => ({ id, name: PRESETS[id].label, description: PRESETS[id].description, min_net_worth: PRESETS[id].need, allowed: !(vt.strict_tiers && net < PRESETS[id].need), values: presetValues(id) })),
      smart_enabled: vt.smart_enabled,
      strict_tiers: vt.strict_tiers,
      locked_fields: [...vt.locked_fields],
      lockable_fields: [...MANAGED_FIELDS],
      effective: {
        buy_enabled: pv.buy_enabled,
        max_buy_price: pv.wtb_avg_price_cap,
        max_total_buy: pv.wtb_max_total_price_cap,
        buy_quantity: active.length ? 1 : pv.wtb_buy_quantity,
        volume_threshold: pv.wtb_volume_threshold,
        buy_profit_threshold: pv.wtb_profit_threshold,
        min_roi_percentage: pv.wtb_min_roi_percentage,
        sell_min_profit: pv.wts_min_profit,
        sell_undercut: pv.wts_undercut_step,
        stale_after_days: pv.wts_stale_after_days,
        stale_floor_profit: pv.wts_stale_floor_profit,
        riven_min_profit: pv.riven_min_profit,
        riven_auto_match_stats: pv.riven_auto_match_stats,
        riven_undercut: pv.riven_undercut_step,
      },
      active_adjustments: active,
      recent_adjustments: [...active, ...state.adjustments, { time: iso(NOW - 26 * 3600000), field: "items.wts.undercut_step", from: "1", to: "2", reason: "Stock is not moving: undercutting by 2p until something sells." }, { time: iso(NOW - 50 * 3600000), field: "items.wtb.avg_price_cap", from: "15", to: "12", reason: "Balance dipped under 100p: lowered the most you pay per item." }],
    };
  };

  // ------------------------------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------------------------------
  const callbacks = new Map();
  const listeners = new Map(); // event -> [{ id, handler }]
  let callbackId = 1;
  let eventId = 1;
  const transformCallback = (callback, once = false) => {
    const id = callbackId++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return callback && callback(data);
    });
    return id;
  };
  const emit = (event, payload) => {
    H.emitted.push({ event, payload });
    let delivered = 0;
    for (const l of listeners.get(event) || []) {
      const cb = callbacks.get(l.handler);
      if (cb) {
        cb({ event, id: l.id, payload: clone(payload) });
        delivered++;
      }
    }
    return delivered;
  };
  /** send_event!(UIEvent, data): the app's own event bus rides on the "message" Tauri event. */
  const emitMessage = (event, data) => emit("message", { event, data });
  /** send_event_update!(UIEvent, operation, data) */
  const emitUpdate = (event, operation, data) => emit("message_update", { event, operation, data });
  const later = (fn, ms = 30) => setTimeout(fn, ms);

  // ------------------------------------------------------------------------------------------
  // app commands
  // ------------------------------------------------------------------------------------------
  const notFound = (component, what) => {
    throw rustError(component, `${what} not found`);
  };
  /** FieldChange + merged, zero-nullified properties, like UpdateStockItem::apply_to. */
  const applyUpdate = (row, input, fields, allowedProps) => {
    for (const f of fields) if (input[f] !== undefined) row[f] = input[f] === null ? undefined : input[f];
    if (input.properties && typeof input.properties === "object") {
      const merged = { ...(row.properties || {}) };
      for (const [k, v] of Object.entries(input.properties)) {
        if (!allowedProps.includes(k)) continue;
        if (v === null || v === 0 || v === false || v === undefined) delete merged[k];
        else merged[k] = v;
      }
      if (Object.keys(merged).length) row.properties = merged;
      else delete row.properties;
    }
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    row.updated_at = iso(Date.now());
    return row;
  };
  const sameSub = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  const addTransaction = (base, type, price, quantity, profit) => {
    const t = { id: state.nextId++, credits: 0, properties: null, user_name: "", transaction_type: type, quantity, price, profit, updated_at: iso(Date.now()), created_at: iso(Date.now()), ...base };
    state.transactions.unshift(t);
    later(() => emitUpdate("Transaction:RefreshTransactions", "CREATE_OR_UPDATE", t));
    return t;
  };
  const stockRefresh = (event, operation, row) => later(() => emitUpdate(event, operation, clone(row)));

  /** helper::populate_item_market_properties: what the item / wish list / order detail dialogs read. */
  const itemMarketProperties = (base, wfmUrl, subType, bought, listPrice, orderType) => {
    const it = itemBy(wfmUrl);
    const txs = state.transactions.filter((t) => t.wfm_id === it.wfmId);
    const order = state.orders.find((o) => o.itemId === it.wfmId && o.type === orderType);
    const platinum = order ? order.platinum : listPrice || 0;
    const marketOrder = (type, plat, n) => ({ id: hex(24), type, platinum: plat, quantity: 1 + (n % 3), perTrade: 1, rank: subType?.rank ?? null, subtype: subType?.variant ?? null, visible: true, createdAt: iso(NOW - n * 3600000), updatedAt: iso(NOW - n * 1800000), itemId: it.wfmId, user: { id: hex(24), ingame_name: BUYERS[n % BUYERS.length], reputation: n * 3, avatar: null, status: "ingame" }, properties: { item_name: it.name, wfm_url: it.wfmUrl, image_url: it.icon } });
    const sellLowest = Math.round(it._price * 0.95);
    const buyHighest = Math.round(it._price * 0.7);
    return {
      ...(base || {}),
      name: it.name,
      image: it.icon,
      t_type: it.subTypes || null,
      bulk_tradable: it.bulkTradable,
      roi_percent: bought > 0 ? ((platinum - bought) / bought) * 100 : 0,
      potential_profit: platinum - bought,
      report: financialReport(txs),
      last_transactions: clone(txs.slice(0, 5)),
      sell_highest_price: Math.round(it._price * 1.4),
      sell_lowest_price: sellLowest,
      buy_highest_price: buyHighest,
      buy_lowest_price: Math.round(it._price * 0.4),
      supply: 14,
      demand: 6,
      spread: sellLowest - buyHighest,
      spread_percent: sellLowest > 0 ? ((sellLowest - buyHighest) / sellLowest) * 100 : 0,
      orders: [0, 1, 2, 3, 4].map((n) => marketOrder(orderType, orderType === "sell" ? sellLowest + n * 2 : buyHighest - n * 2, n)),
      ...(order ? order.properties : {}),
      ui_operations: ["MarketInfo", "TransactionInfo", "ProfitabilityInfo"],
    };
  };
  /** helper::populate_riven_market_properties */
  const rivenMarketProperties = (base, riven) => {
    const w = weaponBy(riven.wfm_weapon_url);
    const txs = state.transactions.filter((t) => t.item_type === "riven" && t.wfm_url === riven.wfm_weapon_url);
    const platinum = riven.list_price || 0;
    return {
      ...(base || {}),
      name: w.name,
      image: w.icon,
      disposition_rank: w.dispositionRank,
      roi_percent: riven.bought > 0 ? ((platinum - riven.bought) / riven.bought) * 100 : 0,
      potential_profit: platinum - riven.bought,
      report: financialReport(txs),
      last_transactions: clone(txs.slice(0, 5)),
      grade: "good",
      ranks: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((rank) => riven.attributes.map((a) => ({ ...a, value: Math.round(((a.value * (rank + 1)) / 9) * 10) / 10 }))),
      variants: [{ name: w.name, unique_name: w.uniqueName, disposition: w.disposition, disposition_rank: w.dispositionRank, ranks: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((rank) => riven.attributes.map((a) => ({ ...a, value: Math.round(((a.value * (rank + 1)) / 9) * 10) / 10 }))) }],
      roll_evaluation: { valid_rolls: [{ required: riven.attributes.filter((a) => a.positive).slice(0, 1).map((a) => ({ label: a.wfmUrl, matches: true })), optional: riven.attributes.filter((a) => a.positive).slice(1).map((a) => ({ label: a.wfmUrl, matches: true })) }], tolerated_negative_attributes: riven.attributes.filter((a) => !a.positive).map((a) => ({ label: a.wfmUrl, matches: true })) },
      auctions: clone(state.auctions.slice(0, 3)),
      ui_operations: ["MarketInfo", "TransactionInfo", "ProfitabilityInfo"],
    };
  };

  // ------------------------------------------------------------------------------------------
  // Market Observatory (src-tauri/src/commands/void_market.rs): vt_market_overview,
  // vt_order_book, vt_price_history. Deterministic per item (hash, not the shared rnd).
  // The catalogue items carry the real flags (stock, live orders, wish list, inventory);
  // synthetic filler brings the sky to ~1,500 items like the real price cache.
  // ------------------------------------------------------------------------------------------
  const h01 = (str, salt = 0) => {
    let x = 0x811c9dc5 ^ salt;
    for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 0x01000193);
    x ^= x >>> 15;
    x = Math.imul(x, 0x2c1b3c6d);
    x ^= x >>> 12;
    return (x >>> 0) / 4294967296;
  };
  const logn = (key, salt, m, sp) => {
    const u = h01(key, salt) * 0.998 + 0.001;
    const v = h01(key, salt + 1) * 0.998 + 0.001;
    return m * Math.pow(sp, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  };
  const marketRow = (url, name, category, price, volume, extra) => {
    const unknown = h01(url, 91) < 0.05;
    let trend = Math.max(-0.5, Math.min(0.5, (h01(url, 31) - 0.5) * 0.3));
    if (h01(url, 37) < 0.06) trend = (h01(url, 41) < 0.5 ? -1 : 1) * (0.15 + h01(url, 43) * 0.25);
    const avg = Math.max(1, Math.round(price * 10) / 10);
    return {
      wfm_url: url, wfm_id: url, name, category, avg_price: avg, median: Math.round(avg),
      min_price: Math.max(1, Math.round(avg * 0.7)), max_price: Math.round(avg * 1.4), volume: Math.round(volume * 10) / 10,
      moving_avg: unknown ? null : Math.round((avg / (1 + trend)) * 100) / 100,
      trend: unknown ? 0 : Math.round(trend * 1000) / 1000,
      trend_dir: unknown ? "unknown" : trend > 0.05 ? "rising" : trend < -0.05 ? "falling" : "flat",
      profit_margin: Math.round(avg * 0.2 * 10) / 10, variant: "",
      flags: { stock: false, live_order: false, wish: false, inventory: false, riven: false }, owned: 0, ...extra,
    };
  };
  const FILLER_CATS = [["prime", 430, 12], ["set", 120, 60], ["mod", 260, 15], ["arcane", 90, 20], ["relic", 290, 5], ["other", 70, 25]];
  const FILLER_WORDS = ["Aurora", "Cinder", "Halcyon", "Meridian", "Obelisk", "Quasar", "Sable", "Tessera", "Umbra", "Vesper", "Zenith", "Lumen", "Corvid", "Ember", "Solace"];
  let marketFiller = null;
  const fillerItems = () => {
    if (marketFiller) return marketFiller;
    marketFiller = [];
    for (const [cat, n, med] of FILLER_CATS)
      for (let i = 0; i < n; i++) {
        const w = FILLER_WORDS[i % FILLER_WORDS.length];
        const name = cat === "relic" ? `${["Lith", "Meso", "Neo", "Axi"][i % 4]} ${String.fromCharCode(65 + (i % 23))}${10 + Math.floor(i / 23)} Relic` : `Mock ${w} ${cat === "set" ? `Prime Set ${i}` : cat === "prime" ? `Prime Part ${i}` : cat === "arcane" ? `Arcane ${i}` : `${cat} ${i}`}`;
        const url = slug(name);
        marketFiller.push(marketRow(url, name, cat, logn(url, 1, med, 1.9), logn(url, 2, 20, 2.1), { variant: cat === "mod" ? "r10" : cat === "relic" ? "intact" : "" }));
      }
    return marketFiller;
  };
  const marketOverview = () => {
    const live = new Set(state.orders.filter((o) => o.type === "sell").map((o) => o.properties && o.properties.wfm_url));
    const stocked = new Set(state.stockItems.map((r) => r.wfm_url));
    for (const r of state.stockItems) if (r.status === "live" && !r.is_hidden) live.add(r.wfm_url);
    const wished = new Set(state.wishList.map((r) => r.wfm_url));
    const owned = new Map(state.owned.map((o) => [o.item.wfmUrl, o.quantity]));
    const rows = items.filter((i) => i._price > 0).map((i) =>
      marketRow(i.wfmUrl, i.name, categoryOf(i.tags), i._price, i._volume, {
        wfm_id: i.wfmId,
        variant: i._maxRank ? `r${i._maxRank}` : "",
        flags: { stock: stocked.has(i.wfmUrl), live_order: live.has(i.wfmUrl), wish: wished.has(i.wfmUrl), inventory: owned.has(i.wfmUrl), riven: false },
        owned: owned.get(i.wfmUrl) || 0,
      }),
    );
    const stockedRivens = new Set(state.stockRivens.map((r) => r.wfm_weapon_url));
    const rivens = state.rivenPrices.map((r) => ({ ...marketRow(r.wfm_url, `${r.name} Riven`, "riven", r.median_price, r.volume), wfm_id: r.wfm_id, moving_avg: null, flags: { stock: stockedRivens.has(r.wfm_url), live_order: state.stockRivens.some((x) => x.wfm_weapon_url === r.wfm_url && x.status === "live"), wish: false, inventory: false, riven: true } }));
    const all = [...rows, ...fillerItems(), ...rivens];
    return { items: all, generated_at: iso(Date.now()), trend_basis: "Relative gap between the cached average price and its moving average ((avg - moving_avg) / moving_avg); flat within 5 %. Rivens: latest scan median against a scan a day or more older.", price_rows: rows.length + marketFiller.length, rivens: rivens.length, history_days: 0 };
  };
  state.marketBooks = {};
  const STATUSES = ["ingame", "ingame", "online", "online", "offline"];
  const marketBook = (url, variant) => {
    const all = marketOverview().items;
    const star = all.find((i) => i.wfm_url === url);
    if (!star) throw rustError("VoidTrader:Market", `Failed to read the order book of ${url}`, { cause: "ApiError: NotFound" });
    if (!state.marketBooks[url]) {
      const p = star.median || 10;
      const mine = state.stockItems.find((r) => r.wfm_url === url && r.status === "live" && r.list_price);
      const floor = mine ? mine.list_price + 1 : Math.round(p * 0.95);
      const v = star.variant;
      const ord = (side, price, k, own) => ({ id: `${url}-${side}-${k}`, side, platinum: price, quantity: 1 + Math.floor(h01(url, k + 7) * 6), ...(v.startsWith("r") ? { rank: Number(v.slice(1)) } : {}), ...(v && !v.startsWith("r") ? { subtype: v } : {}), variant: v, user: own ? state.user.wfm_username : `Trader${Math.floor(h01(url, k) * 900 + 100)}`, status: own ? "ingame" : STATUSES[Math.floor(h01(url, k + 3) * STATUSES.length)], reputation: Math.floor(h01(url, k + 5) * 200), own, updated_at: iso(NOW - k * 600000) });
      const orders = [];
      for (let k = 0; k < 10; k++) orders.push(ord("sell", floor + Math.round(k * Math.max(1, p * 0.04) * (0.6 + h01(url, k))), k, false));
      for (let k = 0; k < 6; k++) orders.push(ord("buy", Math.max(1, Math.round(p * 0.82 - k * Math.max(1, p * 0.04))), 20 + k, false));
      if (mine) orders.push(ord("sell", mine.list_price, 99, true));
      state.marketBooks[url] = orders;
    }
    const orders = state.marketBooks[url];
    const variants = star.variant ? [{ key: star.variant, label: star.variant.startsWith("r") ? `Rank ${star.variant.slice(1)}` : star.variant[0].toUpperCase() + star.variant.slice(1), sells: orders.filter((o) => o.side === "sell").length, buys: orders.filter((o) => o.side === "buy").length, sells_ingame: orders.filter((o) => o.side === "sell" && o.status === "ingame").length }] : [];
    const sells = orders.filter((o) => o.side === "sell").sort((a, b) => a.platinum - b.platinum);
    const buys = orders.filter((o) => o.side === "buy").sort((a, b) => b.platinum - a.platinum);
    const mn = (xs) => (xs.length ? Math.min(...xs) : null);
    const mx = (xs) => (xs.length ? Math.max(...xs) : null);
    const bsi = mn(sells.filter((o) => o.status === "ingame").map((o) => o.platinum));
    const bbi = mx(buys.filter((o) => o.status === "ingame").map((o) => o.platinum));
    const ownSell = mn(sells.filter((o) => o.own).map((o) => o.platinum));
    const other = mn(sells.filter((o) => !o.own && o.status === "ingame").map((o) => o.platinum));
    const cut = ownSell !== null && other !== null && other < ownSell ? ownSell - other : null;
    return {
      wfm_url: url, name: star.name, variant: star.variant, variants, sells: clone(sells), buys: clone(buys),
      summary: { best_sell_ingame: bsi, best_sell_online: mn(sells.filter((o) => o.status !== "offline").map((o) => o.platinum)), best_sell_any: mn(sells.map((o) => o.platinum)), best_buy_ingame: bbi, best_buy_any: mx(buys.map((o) => o.platinum)), spread: bsi !== null && bbi !== null ? bsi - bbi : null, sellers_ingame: sells.filter((o) => o.status === "ingame").length, buyers_ingame: buys.filter((o) => o.status === "ingame").length, sell_count: sells.length, buy_count: buys.length, own_sell: ownSell, own_buy: mx(buys.filter((o) => o.own).map((o) => o.platinum)), undercut_by: cut, own_is_best: ownSell !== null && cut === null },
      fetched_at: iso(Date.now()), age_secs: 0, from_cache: false, ttl_secs: 40,
    };
  };
  /** Test helper: an in-game seller undercuts your order on this item (next vt_order_book shows it). */
  const marketUndercut = (url, by = 2) => {
    const own = (state.marketBooks[url] || []).find((o) => o.own && o.side === "sell");
    if (!own) return false;
    state.marketBooks[url].push({ ...own, id: `${url}-cut-${Date.now()}`, platinum: Math.max(1, own.platinum - by), user: "UndercutterX", own: false, status: "ingame" });
    return true;
  };
  const marketHistory = (url, riven) => {
    const star = marketOverview().items.find((i) => i.wfm_url === url && (!riven || i.flags.riven));
    if (!star) return { wfm_url: url, source: "cache_snapshot", note: "No price data for this item.", points: [], snapshot: null, variant: "" };
    const snapshot = { avg: star.avg_price, min: star.min_price, max: star.max_price, median: star.median, volume: star.volume, moving_avg: star.moving_avg, variant: star.variant };
    const n = riven ? 5 : 90;
    const points = [];
    for (let i = 0; i < n; i++) {
      const avg = Math.max(1, star.avg_price * (1 - (star.trend || 0) * (1 - i / (n - 1)) + (h01(url, 200 + i) - 0.5) * 0.08));
      points.push({ date: iso(NOW - (n - 1 - i) * DAY).slice(0, 10) + "T00:00:00Z", avg: Math.round(avg * 10) / 10, min: Math.max(1, Math.round(avg * 0.8)), max: Math.round(avg * 1.25), median: Math.round(avg), volume: Math.round(star.volume * (0.6 + h01(url, 300 + i) * 0.8)) });
    }
    return riven
      ? { wfm_url: url, source: "riven_scans", note: `${n} riven market scans of live buyout auctions (Void Trader's own scans).`, points, snapshot, variant: "" }
      : { wfm_url: url, source: "wfm_statistics_90d", note: `warframe.market closed trades, last ${n} days.`, points, snapshot, variant: star.variant };
  };

  const commands = {
    // --- app
    initialized: () => state.started,
    app_get_app_info: () => ({ version: "1.12.0", name: "Void Trader", description: "Void Trader (mock backend)", authors: "Kenya-DK", is_dev: false, use_temp_db: false, tos_uuid: state.settings.tos_uuid, is_pre_release: false, patreon_usernames: ["Willjsnider s", "DAn IguEss"] }),
    app_get_settings: () => clone(state.settings),
    app_get_default_settings: () => defaultSettings(),
    app_update_settings: ({ settings }) => {
      const next = clone(settings);
      next.notifications.custom_sounds = clone(state.settings.notifications.custom_sounds);
      next.live_scraper.void_trader = clone(state.settings.live_scraper.void_trader);
      state.settings = next;
      return clone(next);
    },
    app_exit: () => null,
    app_accept_tos: ({ id }) => {
      state.settings.tos_uuid = id;
      return null;
    },
    app_notify_reset: ({ id }) => defaultNotifications()[id] || {},
    alert_get_alerts: () => ({ total: state.alerts.length, limit: 25, page: 1, total_pages: 1, results: clone(state.alerts) }),
    track_event: () => null,
    log: () => null,
    log_export: () => "C:\\Users\\tester\\Desktop\\void-trader-logs.zip",

    // --- auth / user
    auth_me: () => clone(state.user),
    auth_login: ({ email, password }) => {
      if (!email || !password) throw rustError("Auth:Login", "Invalid email or password");
      state.user = loggedInUser();
      return clone(state.user);
    },
    auth_logout: () => {
      state.user = anonymousUser();
      return clone(state.user);
    },
    auth_has_permission: () => true,
    user_set_status: ({ status }) => {
      state.user.wfm_status = status;
      later(() => emitUpdate("User:Update", "CREATE_OR_UPDATE", { wfm_status: status }));
      return null;
    },

    // --- cache
    cache_get_tradable_items: () => items.map(publicItem),
    cache_get_riven_weapons: () => clone(WEAPONS),
    cache_get_riven_attributes: () => clone(ATTRS),
    cache_get_syndicates: () => clone(SYNDICATES),
    cache_get_chat_icons: () => [{ name: "heart", code: ":heart:", url: "/imgs/categories/mods.png" }, { name: "platinum", code: ":platinum:", url: "/imgs/categories/set.png" }],
    cache_get_theme_presets: () => clone(state.themes),
    cache_create_theme: ({ name, author, properties }) => {
      state.themes.push({ name, author, fileName: `${slug(name)}.json`, iconBase64: "", properties });
      return null;
    },
    cache_open_theme_folder: () => null,
    cache_get_chat_link: ({ uniqueName }) => {
      const it = itemBy(uniqueName);
      return { prefix: "", link: it ? it.name : uniqueName, suffix: "" };
    },
    get_known_riven_weapons: () => WEAPONS.map((w) => w.wfmRivenUrl),

    // --- dashboard
    dashboard_summary: () => dashboard(),

    // --- live scraper
    live_scraper_get_state: () => ({ is_running: state.running }),
    live_scraper_toggle: () => {
      state.running = !state.running;
      emitMessage("LiveScraper:UpdateRunningState", state.running);
      if (state.running) later(() => state.running && emitMessage("LiveScraper:OnMessage", { i18nKey: "item.checking", values: { name: "Glaive Prime Set", current: 1, total: state.stockItems.length } }), 60);
      else emitMessage("LiveScraper:OnMessage", null);
      return null;
    },
    live_scraper_get_interesting_wtb_items: () =>
      tradable.slice(0, 15).map((i) => ({ wfm_url: i.wfmUrl, wfm_id: i.wfmId, uuid: hex(32), volume: i._volume, max_price: i._price * 1.3, min_price: i._price * 0.8, avg_price: i._price, moving_avg: i._price, median: i._price, profit: Math.round(i._price * 0.2), profit_margin: 20, trading_tax: i.tradeTax, week_price_shift: 1.5, ...(i._maxRank ? { sub_type: { rank: i._maxRank } } : {}), properties: { name: i.name } })),
    vt_strategy_status: () => strategyStatus(),
    vt_strategy_set: ({ preset, smartEnabled, strictTiers, lockedFields, manualPlatinum }) => {
      const vt = clone(state.settings.live_scraper.void_trader);
      if (preset != null) {
        if (!PRESETS[preset]) throw `invalid args \`preset\` for command \`vt_strategy_set\`: unknown variant \`${preset}\``;
        vt.preset = preset;
      }
      if (smartEnabled != null) vt.smart_enabled = smartEnabled;
      if (strictTiers != null) vt.strict_tiers = strictTiers;
      if (manualPlatinum != null) vt.manual_platinum = manualPlatinum < 0 ? null : manualPlatinum;
      if (lockedFields != null) {
        const unknown = lockedFields.find((f) => !MANAGED_FIELDS.includes(f));
        if (unknown) throw rustError("VoidStrategy", `Unknown setting to lock: ${unknown}`);
        vt.locked_fields = lockedFields;
      }
      if (preset != null || strictTiers != null) {
        // net worth is read before the change is applied, like the command does
        const net = netWorth();
        if (vt.strict_tiers && net < PRESETS[vt.preset].need) throw rustError("VoidStrategy", `${PRESETS[vt.preset].label} needs a net worth of ${PRESETS[vt.preset].need}p; yours is ${net}p. Reach that tier or turn off strict tiers.`);
      }
      state.settings.live_scraper.void_trader = vt;
      return strategyStatus();
    },

    // --- stock items
    get_stock_item_pagination: ({ query }) => OPTIONS.corrupt === "stock" ? { total: 1, limit: 200, page: 1, total_pages: 1, results: [null] } : paginate(listQuery(state.stockItems, query, (r) => [r.item_name, r.wfm_url]), query),
    get_stock_item_status_counts: ({ query }) => statusCounts(state.stockItems.filter((r) => textMatch(query?.query, r.item_name))),
    get_stock_item_financial_report: () => {
      const rep = financialReport([]);
      rep.expenses = state.stockItems.reduce((s, i) => s + i.bought * i.owned, 0);
      rep.revenue = state.stockItems.reduce((s, i) => s + (i.list_price || 0) * i.owned, 0);
      rep.total_profit = rep.revenue - rep.expenses;
      rep.total_transactions = state.stockItems.length;
      return rep;
    },
    stock_item_get_by_id: ({ id }) => {
      const row = state.stockItems.find((r) => r.id === id) || notFound("Command::StockItemGetById", "Stock item");
      return { ...clone(row), properties: itemMarketProperties(row.properties, row.wfm_url, row.sub_type, row.bought, row.list_price, "sell") };
    },
    stock_item_create: ({ input }) => {
      const it = itemBy(input.raw);
      if (!it) throw rustError("StockItem:Create", `Item not found: ${input.raw}`);
      const existing = state.stockItems.find((r) => r.wfm_url === it.wfmUrl && sameSub(r.sub_type, input.sub_type));
      let row;
      if (existing) {
        existing.bought = Math.round((existing.bought * existing.owned + (input.bought || 0) * input.quantity) / (existing.owned + input.quantity));
        existing.owned += input.quantity;
        existing.updated_at = iso(Date.now());
        row = existing;
      } else {
        row = { id: state.nextId++, wfm_id: it.wfmId, wfm_url: it.wfmUrl, item_name: it.name, item_unique_name: it.uniqueName, ...(input.sub_type ? { sub_type: input.sub_type } : {}), bought: input.bought || 0, owned: input.quantity, is_hidden: false, status: "pending", price_history: [], updated_at: iso(Date.now()), created_at: iso(Date.now()), is_dirty: false, locked: false, changes: [] };
        state.stockItems.push(row);
      }
      if ((input.bought || 0) > 0) addTransaction({ wfm_id: it.wfmId, wfm_url: it.wfmUrl, item_name: it.name, item_type: "item", item_unique_name: it.uniqueName, tags: it.tags.join(","), ...(input.sub_type ? { sub_type: input.sub_type } : {}) }, "purchase", input.bought * input.quantity, input.quantity, 0);
      stockRefresh("LiveScraper:RefreshStockItems", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    stock_item_update: ({ input }) => {
      const row = state.stockItems.find((r) => r.id === input.id) || notFound("StockItem:UpdateById", "Stock Item");
      applyUpdate(row, input, ["owned", "bought", "list_price", "status", "is_hidden", "sub_type"], ["min_sma", "min_profit", "min_price", "cooldown", "is_bulk"]);
      stockRefresh("LiveScraper:RefreshStockItems", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    stock_item_update_multiple: ({ ids, input }) => ids.map((id) => commands.stock_item_update({ input: { ...input, id } })),
    stock_item_delete: ({ id }) => {
      const row = state.stockItems.find((r) => r.id === id) || notFound("StockItem:DeleteById", "Stock Item");
      state.stockItems = state.stockItems.filter((r) => r.id !== id);
      state.orders = state.orders.filter((o) => !(o.type === "sell" && o.itemId === row.wfm_id));
      stockRefresh("LiveScraper:RefreshStockItems", "DELETE", { id });
      return clone(row);
    },
    stock_item_delete_multiple: ({ ids }) => {
      for (const id of ids) commands.stock_item_delete({ id });
      return ids.length;
    },
    stock_item_sell: ({ wfmUrl, subType, quantity, price }) => {
      const row = state.stockItems.find((r) => r.wfm_url === wfmUrl && sameSub(r.sub_type, subType)) || state.stockItems.find((r) => r.wfm_url === wfmUrl) || notFound("StockItem:Sold", `Stock Item ${wfmUrl}`);
      if (quantity <= 0) throw rustError("StockItem:Sold", "Quantity must be greater than 0");
      const it = itemBy(row.wfm_url);
      // `price` is the total for the whole trade (handlers/base.rs divides it by the quantity);
      // a price of 0 records no transaction ("PriceZeroNoTransaction").
      if (price > 0) addTransaction({ wfm_id: row.wfm_id, wfm_url: row.wfm_url, item_name: row.item_name, item_type: "item", item_unique_name: row.item_unique_name, tags: it.tags.join(","), ...(row.sub_type ? { sub_type: row.sub_type } : {}) }, "sale", price, quantity, (Math.trunc(price / quantity) - row.bought) * quantity);
      row.owned -= quantity;
      row.updated_at = iso(Date.now());
      if (state.inventoryConnected) {
        state.platinum += price;
        state.tradesRemaining = Math.max(0, state.tradesRemaining - 1);
      }
      if (row.owned <= 0) {
        state.stockItems = state.stockItems.filter((r) => r.id !== row.id);
        state.orders = state.orders.filter((o) => !(o.type === "sell" && o.itemId === row.wfm_id));
        stockRefresh("LiveScraper:RefreshStockItems", "DELETE", { id: row.id });
      } else stockRefresh("LiveScraper:RefreshStockItems", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    export_stock_item_json: () => "C:\\Users\\tester\\Desktop\\stock_items.json",

    // --- stock rivens
    get_stock_riven_pagination: ({ query }) => paginate(listQuery(state.stockRivens, query, (r) => [r.weapon_name, r.mod_name]), query),
    get_stock_riven_status_counts: ({ query }) => statusCounts(state.stockRivens.filter((r) => textMatch(query?.query, r.weapon_name, r.mod_name))),
    get_stock_riven_financial_report: () => {
      const rep = financialReport([]);
      rep.expenses = state.stockRivens.reduce((s, i) => s + i.bought, 0);
      rep.revenue = state.stockRivens.reduce((s, i) => s + (i.list_price || 0), 0);
      rep.total_profit = rep.revenue - rep.expenses;
      rep.total_transactions = state.stockRivens.length;
      return rep;
    },
    stock_riven_get_by_id: ({ id }) => {
      const row = state.stockRivens.find((r) => r.id === id) || notFound("Command::StockRivenGetById", "Stock riven");
      return { ...clone(row), properties: rivenMarketProperties(row.properties, row) };
    },
    stock_riven_create: ({ input }) => {
      const w = weaponBy(input.raw);
      if (!w) throw rustError("StockRiven:Create", `Weapon not found: ${input.raw}`);
      const row = rivenRow(w.name, input.mod_name, input.bought || 0, null, "pending", input.mastery_rank, input.re_rolls, input.attributes, { polarity: input.polarity });
      row.sub_type = { rank: input.rank };
      state.stockRivens.push(row);
      stockRefresh("LiveScraper:RefreshStockRivens", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    stock_riven_update: ({ input }) => {
      const row = state.stockRivens.find((r) => r.id === input.id) || notFound("StockRiven:UpdateById", "Stock Riven");
      applyUpdate(row, input, ["bought", "list_price", "re_rolls", "mastery_rank", "status", "is_hidden", "filter"], ["min_price", "min_profit", "cooldown", "is_predicted"]);
      stockRefresh("LiveScraper:RefreshStockRivens", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    stock_riven_update_multiple: ({ ids, input }) => ids.map((id) => commands.stock_riven_update({ input: { ...input, id } })),
    stock_riven_delete: ({ id }) => {
      const row = state.stockRivens.find((r) => r.id === id) || notFound("StockRiven:DeleteById", "Stock Riven");
      state.stockRivens = state.stockRivens.filter((r) => r.id !== id);
      state.auctions = state.auctions.filter((a) => a.uuid !== row.uuid);
      stockRefresh("LiveScraper:RefreshStockRivens", "DELETE", { id });
      return clone(row);
    },
    stock_riven_delete_multiple: ({ ids }) => {
      for (const id of ids) commands.stock_riven_delete({ id });
      return ids.length;
    },
    stock_riven_sell: ({ wfmUrl, modName, price }) => {
      const row = state.stockRivens.find((r) => r.wfm_weapon_url === wfmUrl && r.mod_name === modName) || notFound("StockRiven:Sold", `Stock Riven ${wfmUrl} ${modName}`);
      addTransaction({ wfm_id: row.wfm_weapon_id, wfm_url: row.wfm_weapon_url, item_name: `${row.weapon_name} ${row.mod_name}`, item_type: "riven", item_unique_name: row.weapon_unique_name, tags: "riven,weapon", sub_type: row.sub_type, properties: { mod_name: row.mod_name, mastery_rank: row.mastery_rank, re_rolls: row.re_rolls, polarity: row.polarity, attributes: row.attributes } }, "sale", price, 1, price - row.bought);
      state.stockRivens = state.stockRivens.filter((r) => r.id !== row.id);
      state.auctions = state.auctions.filter((a) => a.uuid !== row.uuid);
      if (state.inventoryConnected) state.platinum += price;
      stockRefresh("LiveScraper:RefreshStockRivens", "DELETE", { id: row.id });
      return clone(row);
    },
    export_stock_riven_json: () => "C:\\Users\\tester\\Desktop\\stock_rivens.json",

    // --- wish list
    get_wish_list_pagination: ({ query }) => paginate(listQuery(state.wishList, query, (r) => [r.item_name, r.wfm_url]), query),
    get_wish_list_status_counts: ({ query }) => statusCounts(state.wishList.filter((r) => textMatch(query?.query, r.item_name))),
    get_wish_list_financial_report: () => {
      const rep = financialReport([]);
      rep.expenses = state.wishList.reduce((s, i) => s + (i.list_price || 0) * i.quantity, 0);
      rep.total_transactions = state.wishList.length;
      return rep;
    },
    wish_list_get_by_id: ({ id }) => {
      const row = state.wishList.find((r) => r.id === id) || notFound("Command::WishListGetById", "Wish list item");
      return { ...clone(row), properties: itemMarketProperties(row.properties, row.wfm_url, row.sub_type, 0, row.list_price, "buy") };
    },
    wish_list_create: ({ input }) => {
      const it = itemBy(input.raw);
      if (!it) throw rustError("WishList:Create", `Item not found: ${input.raw}`);
      const row = wishRow(it.name, input.quantity, input.properties?.max_price ?? null, null, "pending", { sub_type: input.sub_type });
      state.wishList.push(row);
      stockRefresh("LiveScraper:RefreshWishListItems", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    wish_list_update: ({ input }) => {
      const row = state.wishList.find((r) => r.id === input.id) || notFound("WishList:UpdateById", "Wish List Item");
      applyUpdate(row, input, ["quantity", "list_price", "status", "is_hidden", "sub_type"], ["max_price", "min_price", "cooldown"]);
      stockRefresh("LiveScraper:RefreshWishListItems", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    wish_list_update_multiple: ({ ids, input }) => ids.map((id) => commands.wish_list_update({ input: { ...input, id } })),
    wish_list_delete: ({ id }) => {
      const row = state.wishList.find((r) => r.id === id) || notFound("WishList:DeleteById", "Wish List Item");
      state.wishList = state.wishList.filter((r) => r.id !== id);
      stockRefresh("LiveScraper:RefreshWishListItems", "DELETE", { id });
      return clone(row);
    },
    wish_list_delete_multiple: ({ ids }) => {
      for (const id of ids) commands.wish_list_delete({ id });
      return ids.length;
    },
    wish_list_bought: ({ wfmUrl, subType, quantity, price }) => {
      const row = state.wishList.find((r) => r.wfm_url === wfmUrl && sameSub(r.sub_type, subType)) || state.wishList.find((r) => r.wfm_url === wfmUrl) || notFound("WishList:Bought", `Wish List Item ${wfmUrl}`);
      const it = itemBy(row.wfm_url);
      addTransaction({ wfm_id: row.wfm_id, wfm_url: row.wfm_url, item_name: row.item_name, item_type: "item", item_unique_name: row.item_unique_name, tags: it.tags.join(","), ...(row.sub_type ? { sub_type: row.sub_type } : {}) }, "purchase", price, quantity, 0);
      row.quantity -= quantity;
      if (state.inventoryConnected) state.platinum = Math.max(0, state.platinum - price);
      if (row.quantity <= 0) {
        state.wishList = state.wishList.filter((r) => r.id !== row.id);
        stockRefresh("LiveScraper:RefreshWishListItems", "DELETE", { id: row.id });
      } else stockRefresh("LiveScraper:RefreshWishListItems", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    export_wish_list_json: () => "C:\\Users\\tester\\Desktop\\wish_list.json",

    // --- syndicate items (empty stock, like an account that never imported any)
    get_syndicate_item_pagination: ({ query }) => paginate(state.syndicateItems, query),
    get_syndicate_item_status_counts: () => ({}),
    get_syndicate_item_syndicate_counts: () => ({}),
    get_syndicate_item_financial_report: () => financialReport([]),
    syndicate_item_import_items: () => 0,
    export_syndicate_item_json: () => "C:\\Users\\tester\\Desktop\\syndicate_items.json",
    syndicate_item_prices_lookup: ({ query }) =>
      paginate(
        tradable.filter((i) => i.tags.includes("mod")).map((i, n) => ({ name: i.name, syndicate: SYNDICATES[n % SYNDICATES.length].name, standingCost: 25000, syndicateUniqueName: SYNDICATES[n % SYNDICATES.length].uniqueName, wfmId: i.wfmId, uuid: hex(32), subType: { rank: 0 }, maxPrice: i._price * 1.2, minPrice: i._price * 0.8, volume: i._volume })),
        query,
      ),
    export_syndicate_item_price_data: () => "C:\\Users\\tester\\Desktop\\syndicate_prices.json",

    // --- transactions
    get_transaction_pagination: ({ query }) => {
      const q = query || {};
      let rows = state.transactions.filter((t) => textMatch(q.query, t.item_name, t.user_name));
      if (q.transaction_type) rows = rows.filter((t) => t.transaction_type === q.transaction_type);
      if (q.item_type) rows = rows.filter((t) => t.item_type === q.item_type);
      if (q.from_date) rows = rows.filter((t) => t.created_at >= q.from_date);
      if (q.to_date) rows = rows.filter((t) => t.created_at <= q.to_date);
      return paginate(sortRows(rows, q.sort_by, q.sort_direction), q);
    },
    get_transaction_financial_report: ({ query }) => {
      const q = query || {};
      let rows = state.transactions;
      if (q.from_date) rows = rows.filter((t) => t.created_at >= q.from_date);
      if (q.to_date) rows = rows.filter((t) => t.created_at <= q.to_date);
      const months = {};
      for (const t of rows) (months[t.created_at.slice(0, 7)] ||= []).push(t);
      const labels = Object.keys(months).sort();
      const count = (name) => {
        const m = {};
        for (const t of rows.filter((x) => x.transaction_type === name)) m[t.item_name] = (m[t.item_name] || 0) + t.quantity;
        return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10);
      };
      const year = new Date().getUTCFullYear();
      return {
        ...financialReport(rows),
        properties: {
          graph: { labels, values: { total_trades: labels.map((l) => months[l].length), total_sales: labels.map((l) => financialReport(months[l]).revenue), total_purchase: labels.map((l) => financialReport(months[l]).expenses) } },
          most_purchased_items: count("purchase"),
          most_sold_items: count("sale"),
          categories: state.settings.summary_settings.categories.map((c) => financialReport(rows.filter((t) => t.tags.split(",").some((tag) => c.tags.includes(tag.trim())) || c.types.includes(t.item_type)), { icon: c.icon, name: c.name })),
          total_credits: 0,
          total_trades: rows.length,
          year: financialReport(rows.filter((t) => new Date(t.created_at).getUTCFullYear() === year)),
        },
      };
    },
    transaction_update: ({ input }) => {
      const row = state.transactions.find((t) => t.id === input.id) || notFound("Transaction:UpdateById", "Transaction");
      for (const f of ["price", "quantity", "user_name", "created_at"]) if (input[f] !== undefined && input[f] !== null) row[f] = input[f];
      row.updated_at = iso(Date.now());
      return clone(row);
    },
    transaction_delete: ({ id }) => {
      const row = state.transactions.find((t) => t.id === id) || notFound("Transaction:DeleteById", "Transaction");
      state.transactions = state.transactions.filter((t) => t.id !== id);
      return clone(row);
    },
    transaction_delete_bulk: ({ ids }) => {
      const before = state.transactions.length;
      state.transactions = state.transactions.filter((t) => !ids.includes(t.id));
      return before - state.transactions.length;
    },
    transaction_calculate_tax: () => null,
    export_transaction_json: () => "C:\\Users\\tester\\Desktop\\transactions.json",

    // --- item / riven prices
    item_prices_lookup: ({ query }) => {
      const q = query || {};
      const rows = tradable
        .filter((i) => textMatch(q.query, i.name))
        .map((i) => ({ wfm_url: i.wfmUrl, wfm_id: i.wfmId, sub_type: i._maxRank ? { rank: i._maxRank } : null, avg_price: i._price, supply: Math.round(i._volume * 1.4), demand: Math.round(i._volume * 0.8), closed_price: i._price, donch_bot: i._price * 0.8, donch_top: i._price * 1.2, moving_avg: i._price, open_price: i._price, max_price: Math.round(i._price * 1.3), median: i._price, min_price: Math.round(i._price * 0.8), name: i.name, order_type: "closed", uuid: hex(32), tags: i.tags, trading_tax: i.tradeTax, volume: i._volume, wa_price: i._price, datetime: iso(NOW - DAY) }));
      return paginate(sortRows(rows, q.sort_by, q.sort_direction), q);
    },
    export_item_price_data: () => "C:\\Users\\tester\\Desktop\\item_prices.json",
    vt_riven_prices_lookup: ({ query }) => {
      const q = query || {};
      const rows = state.rivenPrices.filter((r) => textMatch(q.query, r.name, r.wfm_url));
      return paginate(sortRows(rows, q.sort_by, q.sort_direction), q);
    },
    vt_riven_prices_export: () => "C:\\Users\\tester\\Desktop\\riven_prices.json",
    vt_riven_price_history: ({ wfmUrl }) => {
      const base = state.rivenPrices.find((r) => r.wfm_url === wfmUrl);
      return base ? [0, 1, 2, 3, 4].map((d) => ({ ...base, datetime: iso(NOW - d * DAY), median_price: Math.round(base.median_price * (1 - d * 0.02)) })) : [];
    },
    vt_market_overview: () => marketOverview(),
    vt_order_book: ({ wfmUrl, variant }) => marketBook(wfmUrl, variant),
    vt_price_history: ({ wfmUrl, riven }) => marketHistory(wfmUrl, !!riven),
    vt_riven_market_status: () => clone(state.rivenScan),
    vt_riven_market_scan: () => {
      if (!state.rivenScan.running) {
        state.rivenScan = { ...state.rivenScan, running: true, done: 0, total: WEAPONS.length, current: WEAPONS[0].name, started_at: iso(Date.now()), last_error: null };
        const tick = () => {
          if (!state.rivenScan.running) return;
          state.rivenScan.done++;
          if (state.rivenScan.done >= state.rivenScan.total) state.rivenScan = { ...state.rivenScan, running: false, current: "", last_completed: iso(Date.now()) };
          else {
            state.rivenScan.current = WEAPONS[state.rivenScan.done].name;
            setTimeout(tick, 250);
          }
        };
        setTimeout(tick, 250);
      }
      return clone(state.rivenScan);
    },
    vt_riven_market_stop: () => {
      state.rivenScan = { ...state.rivenScan, running: false, current: "" };
      return clone(state.rivenScan);
    },
    riven_pricer_available: () => true,
    riven_pricer_reload: () => true,
    riven_price_predict: ({ input }) => ({ price: 120 + (input.positives || []).length * 60, log_price: 4.8, weapon_idx: 3, attr_indices: [1, 2] }),

    // --- warframe.market
    get_wfm_orders_pagination: ({ query }) => {
      if (OPTIONS.corrupt === "orders") return { total: 1, limit: 25, page: 1, total_pages: 1, results: [null] };
      const q = query || {};
      let rows = state.orders.filter((o) => textMatch(q.query, o.properties.item_name));
      if (q.order_type && q.order_type !== "all") rows = rows.filter((o) => o.type === q.order_type);
      return paginate(sortRows(rows, q.sort_by, q.sort_direction), q);
    },
    get_wfm_orders_status_counts: ({ query }) => {
      const out = { buy: [0, 0, 0], sell: [0, 0, 0] };
      for (const o of state.orders.filter((x) => textMatch(query?.query, x.properties.item_name))) {
        out[o.type][0]++;
        out[o.type][1] += o.platinum * o.quantity;
        out[o.type][2] += (o.properties.potential_profit || 0) * o.quantity;
      }
      return out;
    },
    get_wfm_order_by_id: ({ id }) => {
      const o = state.orders.find((x) => x.id === id) || notFound("Order:GetById", "Order");
      return { ...clone(o), properties: itemMarketProperties(o.properties, o.properties.wfm_url, o.rank != null ? { rank: o.rank } : null, 0, o.platinum, o.type) };
    },
    order_refresh: () => {
      later(() => emitMessage("LiveScraper:RefreshWfmOrders", null));
      return null;
    },
    order_delete_all: ({ orderType }) => {
      state.orders = orderType ? state.orders.filter((o) => o.type !== orderType) : [];
      later(() => emitMessage("LiveScraper:RefreshWfmOrders", null));
      return null;
    },
    order_delete_by_id: ({ id }) => {
      state.orders = state.orders.filter((o) => o.id !== id);
      later(() => emitMessage("LiveScraper:RefreshWfmOrders", null));
      return null;
    },
    handles_handle_items: ({ items: list }) => list.length,
    get_wfm_auctions_pagination: ({ query }) => paginate(state.auctions.filter((a) => textMatch(query?.query, a.properties.item_name)), query),
    get_wfm_auctions_overview: () => [state.auctions.length, state.auctions.length, state.auctions.reduce((s, a) => s + a.buyout_price, 0)],
    get_wfm_auction_by_id: ({ id }) => clone(state.auctions.find((a) => a.id === id) || notFound("Auction:GetById", "Auction")),
    auction_refresh: () => null,
    auction_delete_all: () => {
      state.auctions = [];
      return null;
    },
    auction_delete_by_id: ({ id }) => {
      state.auctions = state.auctions.filter((a) => a.id !== id);
      return null;
    },
    auction_import_by_id: ({ id, bought }) => {
      const a = state.auctions.find((x) => x.id === id) || notFound("Auction:Import", "Auction");
      const w = weaponBy(a.item.weapon_url_name);
      const row = rivenRow(w.name, a.item.name, bought, a.buyout_price, "live", a.item.mastery_level, a.item.re_rolls, a.item.attributes, { polarity: a.item.polarity });
      state.stockRivens.push(row);
      a.properties = { ...a.properties, can_import: false, operations: [], stock_id: row.id };
      stockRefresh("LiveScraper:RefreshStockRivens", "CREATE_OR_UPDATE", row);
      return clone(row);
    },
    get_user_activity: () => {
      const labels = [];
      const registered = [];
      const total = [];
      for (let d = 13; d >= 0; d--) {
        labels.push(iso(NOW - d * DAY).slice(0, 10));
        registered.push(int(18000, 26000));
        total.push(int(40000, 52000));
      }
      return { labels, registered_users_chart: registered, total_users_chart: total };
    },

    // --- chat
    get_chat_pagination: ({ query }) => paginate(sortRows(state.chats.filter((c) => textMatch(query?.query, c.chat_name)), query?.sort_by, query?.sort_direction), query),
    chat_refresh: () => null,
    chat_get_messages_by_id: ({ id }) => {
      const chat = state.chats.find((c) => c.id === id) || notFound("Chat:GetMessages", "Chat");
      // like the command: opening a chat makes it the active one and clears its unread count
      commands.chat_set_active({ id });
      // newest first (the chat view puts new messages in front and reverses the list to draw it)
      return clone(chat.messages).reverse();
    },
    chat_set_active: ({ id }) => {
      state.activeChat = id ?? null;
      const chat = state.chats.find((c) => c.id === id);
      if (chat && chat.unread_count > 0) {
        state.user.unread_messages = Math.max(0, state.user.unread_messages - chat.unread_count);
        chat.unread_count = 0;
        later(() => emitUpdate("User:Update", "CREATE_OR_UPDATE", { unread_messages: state.user.unread_messages }));
      }
      return null;
    },
    chat_send_message: ({ id, msg }) => {
      const chat = state.chats.find((c) => c.id === id) || notFound("Chat:SendMessage", "Chat");
      const message = { id: hex(24), message: msg, raw_message: msg, chat_id: id, send_date: iso(Date.now()), message_from: state.user.wfm_id };
      chat.messages.push(message);
      chat.last_update = message.send_date;
      later(() => emitMessage("Wfm:OnChatMessage", { ...message, requirer_refresh: false }));
      return null;
    },
    chat_delete: ({ id }) => {
      state.chats = state.chats.filter((c) => c.id !== id);
      return id;
    },

    // --- trade entries
    get_trade_entry_pagination: ({ query }) => {
      const q = query || {};
      let rows = state.tradeEntries.filter((r) => textMatch(q.query, r.name));
      if (q.group) rows = rows.filter((r) => r.group === q.group);
      return paginate(sortRows(rows, q.sort_by, q.sort_direction), q);
    },
    trade_entry_get_by_id: ({ id }) => clone(state.tradeEntries.find((r) => r.id === id) || notFound("TradeEntry:GetById", "Trade Entry")),
    trade_entry_create: ({ input }) => {
      const row = tradeEntry(itemBy(input.raw)?.name || input.name || input.raw, input.price, input.group, { sub_type: input.sub_type, tags: (input.tags || []).join(","), properties: input.properties });
      state.tradeEntries.push(row);
      return clone(row);
    },
    trade_entry_create_multiple: ({ inputs }) => {
      for (const input of inputs) commands.trade_entry_create({ input });
      return inputs.length;
    },
    trade_entry_update: ({ input }) => {
      const row = state.tradeEntries.find((r) => r.id === input.id) || notFound("TradeEntry:UpdateById", "Trade Entry");
      for (const f of ["price", "sub_type", "group"]) if (input[f] !== undefined && input[f] !== null) row[f] = input[f];
      if (input.tags) row.tags = input.tags.join(",");
      if (input.properties) row.properties = { ...row.properties, ...input.properties };
      row.updated_at = iso(Date.now());
      return clone(row);
    },
    trade_entry_update_multiple: ({ ids, input }) => ids.map((id) => commands.trade_entry_update({ input: { ...input, id } })),
    trade_entry_delete: ({ id }) => {
      const row = state.tradeEntries.find((r) => r.id === id) || notFound("TradeEntry:DeleteById", "Trade Entry");
      state.tradeEntries = state.tradeEntries.filter((r) => r.id !== id);
      return clone(row);
    },
    trade_entry_delete_multiple: ({ ids }) => {
      state.tradeEntries = state.tradeEntries.filter((r) => !ids.includes(r.id));
      return ids.length;
    },
    export_trade_entry_json: () => "C:\\Users\\tester\\Desktop\\trade_entries.json",

    // --- warframe inventory
    wf_inventory_update: () => {
      const source = state.settings.wf_inventory.source;
      if (source === "None") return null;
      if (OPTIONS.inventory === "missing") throw rustError("WFInventory:Alecaframe", "AlecaFrame data file not found. Start Warframe with AlecaFrame running.");
      state.inventoryConnected = true;
      return null;
    },
    wf_inventory_get_rivens: ({ query }) => {
      const stocked = new Set(state.stockRivens.map((r) => r.uuid));
      const rows = balanceIsLive() ? state.invRivens.filter((r) => textMatch(query?.query, r.name)).map((r) => ({ ...r, properties: { ...r.properties, is_in_stock: stocked.has(r.uuid) } })) : [];
      return paginate(sortRows(rows, query?.sort_by, query?.sort_direction), query);
    },
    wf_inventory_get_syndicates: ({ query }) => paginate(balanceIsLive() ? SYNDICATES.map((s, i) => ({ id: s.uniqueName, name: s.name, unique_name: s.uniqueName, wfm_url: "", quantity: 1, properties: { background_colour: s.backgroundColour, colour: s.iconColour, max_standing: 132000, min_standing: 0, total: 20000 * (i + 1) } })) : [], query),
    vt_sell_finder: ({ minPrice }) => sellFinder(minPrice),
    vt_plat_goal: () => platGoal(),

    // --- sounds
    sound_get_custom_sounds: () => clone(state.customSounds),
    sound_get_custom_sounds_path: () => "C:\\Users\\tester\\AppData\\Roaming\\dev.kenya.quantframe\\sounds",
    sound_add_custom_sound: ({ name, filePath }) => {
      state.customSounds.push({ name, name_key: name.toLowerCase(), file_name: filePath.split(/[\\/]/).pop() });
      return clone(state.customSounds);
    },
    sound_delete_custom_sound: ({ fileName }) => {
      state.customSounds = state.customSounds.filter((s) => s.file_name !== fileName);
      return clone(state.customSounds);
    },

    // --- debug / logs / gdpr
    debug_get_wfm_state: () => ({
      user_orders: { sell_orders: clone(state.orders.filter((o) => o.type === "sell")), buy_orders: clone(state.orders.filter((o) => o.type === "buy")) },
      user_auctions: { auctions: clone(state.auctions) },
      order_limit: 100,
      tracking: { "orders/create": 4, "orders/update": 21, "orders/delete": 2 },
      limiters: { rate_limit: { limit: 3, wait_time_sec: 1, quota_type: "per_second" } },
    }),
    debug_get_ee_logs: ({ query }) =>
      paginate(
        Array.from({ length: 60 }, (_, i) => ({ index: i, line: `${(1200 + i * 0.37).toFixed(3)} Sys [Info]: mock EE.log line ${i}`, prev_line: i ? `${(1200 + (i - 1) * 0.37).toFixed(3)} Sys [Info]: mock EE.log line ${i - 1}` : "", prev_detection: "None", date: NOW - (60 - i) * 1000, ignore_combined: false })).filter((l) => textMatch(query?.query, l.line)),
        query,
      ),
    debug_export_ee_logs: () => "C:\\Users\\tester\\Desktop\\ee_logs.json",
    wfgdpr_get_state: () => ({ was_initialized: false, trade_years: [] }),
    wfgdpr_get_accounts: () => [],
    wfgdpr_load: () => null,
  };

  // ------------------------------------------------------------------------------------------
  // plugins (with the permissions of src-tauri/capabilities/*.json)
  // ------------------------------------------------------------------------------------------
  const PERMISSIONS = new Set(OPTIONS.permissions);
  const permitted = (...ids) => ids.some((id) => PERMISSIONS.has(id));
  const pluginPermission = (plugin, command) => {
    const allow = `${plugin}:allow-${command.replace(/_/g, "-")}`;
    switch (plugin) {
      case "event":
      case "path":
      case "window":
      case "webview":
      case "app":
      case "resources":
      case "image":
      case "menu":
      case "tray":
        return permitted("core:default", `core:${plugin}:default`, `core:${allow}`);
      case "fs":
        if (command === "read_text_file") return permitted(allow, "fs:default", "fs:allow-resource-read-recursive");
        return permitted(allow);
      case "dialog":
        return permitted(allow, "dialog:default");
      case "updater":
        return permitted(allow, "updater:default");
      case "clipboard-manager":
        // clipboard-manager:default grants nothing
        return permitted(allow);
      case "notification":
        return permitted(allow, "notification:default");
      case "shell":
        return permitted(allow);
      case "process":
        return permitted(allow, "process:default");
      case "os":
        return permitted(allow, "os:default");
      case "http":
        return permitted(allow, "http:default");
      default:
        return false;
    }
  };
  const plugins = {
    "event|listen": ({ event, handler }) => {
      const id = eventId++;
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push({ id, handler });
      return id;
    },
    "event|unlisten": ({ event, eventId: id }) => {
      const list = listeners.get(event);
      if (list) {
        const idx = list.findIndex((l) => l.id === id);
        if (idx >= 0) list.splice(idx, 1);
      }
      return null;
    },
    "event|emit": ({ event, payload }) => {
      emit(event, payload);
      return null;
    },
    "event|emit_to": ({ event, payload }) => {
      emit(event, payload);
      return null;
    },
    "path|resolve_directory": ({ path }) => `C:\\Program Files\\Void Trader\\${String(path || "").replace(/\//g, "\\")}`,
    "path|join": ({ paths }) => paths.join("\\"),
    "path|resolve": ({ paths }) => paths.join("\\"),
    "path|normalize": ({ path }) => path,
    "path|basename": ({ path }) => String(path).split(/[\\/]/).pop(),
    "path|dirname": ({ path }) => String(path).split(/[\\/]/).slice(0, -1).join("\\"),
    "path|extname": ({ path }) => (String(path).match(/\.([^.\\/]+)$/) || ["", ""])[1],
    "fs|read_text_file": ({ path }) => {
      if (/tos\.md$/i.test(String(path))) return Array.from(new TextEncoder().encode(TOS_TEXT));
      throw `failed to open file at path: ${path} with error: The system cannot find the file specified. (os error 2)`;
    },
    "fs|exists": () => false,
    "updater|check": () => (OPTIONS.updateAvailable ? { rid: 7, currentVersion: "1.12.0", version: "1.13.0", date: iso(NOW), body: "## 1.13.0 (mock)\n- A pretend update for the harness.", rawJson: { notes: "mock" } } : null),
    "updater|download_and_install": () => null,
    "dialog|open": ({ options }) => (options?.multiple ? ["C:\\Users\\tester\\Desktop\\picked.file"] : "C:\\Users\\tester\\Desktop\\picked.file"),
    "dialog|save": () => "C:\\Users\\tester\\Desktop\\saved.file",
    "dialog|message": () => true,
    "dialog|ask": () => true,
    "dialog|confirm": () => true,
    "shell|open": ({ path }) => {
      state.opened.push(path);
      return null;
    },
    "clipboard-manager|write_text": ({ text }) => {
      state.clipboard = text;
      return null;
    },
    "clipboard-manager|read_text": () => state.clipboard,
    "process|restart": () => null,
    "process|exit": () => null,
    "notification|is_permission_granted": () => true,
    "notification|notify": () => null,
    "os|platform": () => "windows",
    "resources|close": () => null,
    "webview|get_all_webviews": () => [{ label: "main", windowLabel: "main" }],
    "window|get_all_windows": () => ["main"],
  };

  // ------------------------------------------------------------------------------------------
  // contract checks
  // ------------------------------------------------------------------------------------------
  const typeProblem = (kind, value) => {
    switch (kind) {
      case "string":
        return typeof value === "string" ? null : `invalid type: ${describe(value)}, expected a string`;
      case "int":
        return typeof value === "number" && Number.isInteger(value) ? null : `invalid type: ${describe(value)}, expected i64`;
      case "number":
        return typeof value === "number" && Number.isFinite(value) ? null : `invalid type: ${describe(value)}, expected f64`;
      case "bool":
        return typeof value === "boolean" ? null : `invalid type: ${describe(value)}, expected a boolean`;
      case "array":
        return Array.isArray(value) ? null : `invalid type: ${describe(value)}, expected a sequence`;
      case "object-or-enum":
        return value !== null && (typeof value === "object" || typeof value === "string") ? null : `invalid type: ${describe(value)}, expected a struct`;
      default:
        return null;
    }
  };
  const describe = (v) => (v === null ? "null" : Array.isArray(v) ? "sequence" : typeof v === "number" ? (Number.isInteger(v) ? `integer \`${v}\`` : `floating point \`${v}\``) : typeof v === "string" ? `string "${v}"` : typeof v === "boolean" ? `boolean \`${v}\`` : typeof v === "object" ? "map" : typeof v);
  const checkContract = (cmd, args) => {
    const spec = CONTRACT[cmd];
    const sent = args && typeof args === "object" ? args : {};
    for (const [name, t] of Object.entries(spec.args)) {
      const value = sent[name];
      if (value === undefined || value === null) {
        if (!t.optional && !(value === null && t.kind === "any")) {
          // Tauri's own wording
          return value === undefined ? `invalid args \`${name}\` for command \`${cmd}\`: command ${cmd} missing required key ${name}` : `invalid args \`${name}\` for command \`${cmd}\`: invalid type: null, expected ${t.rust}`;
        }
        continue;
      }
      const problem = typeProblem(t.kind, value);
      if (problem) return `invalid args \`${name}\` for command \`${cmd}\`: ${problem}`;
    }
    const extra = Object.keys(sent).filter((k) => !(k in spec.args) && sent[k] !== undefined);
    if (extra.length) {
      const key = `${cmd}: ${extra.sort().join(", ")}`;
      if (!H.extraArgs.includes(key)) H.extraArgs.push(key);
    }
    return null;
  };

  // ------------------------------------------------------------------------------------------
  // invoke
  // ------------------------------------------------------------------------------------------
  const H = {
    state,
    /** Market Observatory: an in-game seller undercuts your sell order on `url` (returns false without one). */
    marketUndercut,
    options: OPTIONS,
    calls: [],
    counts: {},
    /** Registered commands the mock has no handler for (must stay empty). */
    unknown: [],
    /** Commands the frontend called that the Rust backend does not register. */
    notRegistered: [],
    /** Calls the real backend would reject at the argument layer. */
    contractErrors: [],
    /** Arguments the frontend sends that the Rust command does not take (ignored by Tauri). */
    extraArgs: [],
    /** Plugin calls the capability files do not allow. */
    denied: [],
    /** Handler rejections (expected ones included), for the test to inspect. */
    rejections: [],
    emitted: [],
    failNext: {},
    emit,
    emitMessage,
    emitUpdate,
    listeners: () => Object.fromEntries([...listeners.entries()].map(([k, v]) => [k, v.length])),
    /** Make the next call of `cmd` reject with `error`. */
    fail(cmd, error) {
      H.failNext[cmd] = error ?? rustError("Mock", `Forced failure of ${cmd}`);
    },
    /** A buyer writes on warframe.market: updates the chat list, then emits the event like ws.rs does. */
    chatMessage(chatIndex, text, newChatName) {
      let chat = state.chats[chatIndex];
      if (newChatName) {
        chat = makeChat(newChatName, 5, "ingame", [], 0, 0);
        state.chats.unshift(chat);
      }
      const message = { id: hex(24), message: text, raw_message: text, chat_id: chat.id, send_date: iso(Date.now()), message_from: chat.chat_with[0].id };
      chat.messages.push(message);
      chat.last_update = message.send_date;
      if (state.activeChat !== chat.id) {
        chat.unread_count++;
        state.user.unread_messages++;
        emitUpdate("User:Update", "CREATE_OR_UPDATE", { unread_messages: state.user.unread_messages });
      }
      emitMessage("Wfm:OnChatMessage", { ...message, requirer_refresh: Boolean(newChatName) && false });
      return chat.id;
    },
    /** The log parser saw a finished trade: the backend records it, then emits add_trade. */
    trade(playerName, platinum, type = "Sale", itemName = "Nova Prime Set") {
      const it = itemBy(itemName);
      addTransaction({ wfm_id: it.wfmId, wfm_url: it.wfmUrl, item_name: it.name, item_type: "item", item_unique_name: it.uniqueName, tags: it.tags.join(","), user_name: playerName }, type.toLowerCase() === "sale" ? "sale" : "purchase", platinum, 1, type.toLowerCase() === "sale" ? Math.round(platinum * 0.4) : 0);
      if (state.inventoryConnected) state.platinum += type.toLowerCase() === "sale" ? platinum : -platinum;
      return emit("add_trade", { playerName, tradeTime: iso(Date.now()), type, platinum, credits: 0, items: [{ item_type: "item", quantity: 1, raw: it.uniqueName, unique_name: it.uniqueName, properties: { name: it.name, price: platinum } }] });
    },
    whisper(playerName) {
      return emit("vt_whisper", { playerName });
    },
  };
  window.__HARNESS__ = H;

  // count listeners on window and document, so the test can prove a remount does not leak them
  const tracked = new Map();
  for (const target of [window, document]) {
    const name = target === window ? "window" : "document";
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const seen = new Map(); // type -> Set of "listener|capture"
    const ids = new WeakMap();
    let next = 1;
    const keyOf = (listener, options) => {
      if (!listener || (typeof listener !== "function" && typeof listener !== "object")) return null;
      if (!ids.has(listener)) ids.set(listener, next++);
      const capture = typeof options === "boolean" ? options : Boolean(options && options.capture);
      return `${ids.get(listener)}|${capture}`;
    };
    target.addEventListener = (type, listener, options) => {
      const key = keyOf(listener, options);
      if (key) {
        if (!seen.has(type)) seen.set(type, new Set());
        seen.get(type).add(key);
      }
      return add(type, listener, options);
    };
    target.removeEventListener = (type, listener, options) => {
      const key = keyOf(listener, options);
      if (key && seen.has(type)) seen.get(type).delete(key);
      return remove(type, listener, options);
    };
    tracked.set(name, seen);
  }
  H.domListeners = () => {
    const out = {};
    for (const [name, seen] of tracked) for (const [type, set] of seen) if (set.size) out[`${name}:${type}`] = set.size;
    return out;
  };
  /** The backend finished starting (lib.rs emits app:ready once). */
  H.ready = () => {
    state.started = true;
    return emit("app:ready", null);
  };

  const invoke = (cmd, args, _options) =>
    new Promise((resolve, reject) => {
      const record = { cmd, args: clone(args) };
      if (!cmd.startsWith("plugin:event|")) H.calls.push(record);
      H.counts[cmd] = (H.counts[cmd] || 0) + 1;
      const fail = (error, bucket) => {
        record.error = error;
        if (bucket) bucket.push({ cmd, args: clone(args), error });
        H.rejections.push({ cmd, error });
        setTimeout(() => reject(error), OPTIONS.latency);
      };
      const ok = (value) => {
        setTimeout(() => resolve(value), OPTIONS.latency);
      };
      try {
        if (cmd.startsWith("plugin:")) {
          const key = cmd.slice("plugin:".length);
          const [plugin, command] = key.split("|");
          if (!pluginPermission(plugin, command)) {
            console.error(`[harness] plugin call not allowed by src-tauri/capabilities: ${cmd}`);
            return fail(`${plugin}.${command} not allowed. Permissions associated with this command: ${plugin}:allow-${command.replace(/_/g, "-")}`, H.denied);
          }
          if (!(key in plugins)) {
            console.error(`[harness] UNKNOWN PLUGIN COMMAND: ${cmd}`, args);
            H.unknown.push(cmd);
            return ok(null);
          }
          return ok(plugins[key](args || {}));
        }
        if (!(cmd in CONTRACT)) {
          console.error(`[harness] COMMAND NOT REGISTERED IN RUST: ${cmd}`, args);
          return fail(`Command ${cmd} not found`, H.notRegistered);
        }
        const problem = checkContract(cmd, args);
        if (problem) {
          console.error(`[harness] CONTRACT VIOLATION: ${problem}`, args);
          return fail(problem, H.contractErrors);
        }
        if (H.failNext[cmd]) {
          const error = H.failNext[cmd];
          delete H.failNext[cmd];
          return fail(error);
        }
        if (!(cmd in commands)) {
          console.error(`[harness] UNKNOWN COMMAND (no mock handler): ${cmd}`, args);
          H.unknown.push(cmd);
          return ok(null);
        }
        return ok(commands[cmd](args || {}));
      } catch (e) {
        if (e instanceof Error) {
          console.error(`[harness] mock handler for ${cmd} crashed`, e);
          H.unknown.push(`${cmd} (handler crashed: ${e.message})`);
          return fail(rustError("Mock", `mock handler crashed: ${e.message}`));
        }
        return fail(e);
      }
    });

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    runCallback: (id, data) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (filePath, protocol = "asset") => `http://${protocol}.localhost/${encodeURIComponent(filePath)}`,
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    plugins: { path: { sep: "\\", delimiter: ";" } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, id) => {
      for (const list of listeners.values()) {
        const l = list.find((x) => x.id === id);
        if (l) callbacks.delete(l.handler);
      }
    },
  };
  window.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: "windows", os_type: "windows", family: "windows", arch: "x86_64", version: "10.0.22631", eol: "\r\n", exe_extension: "exe" };
})();
