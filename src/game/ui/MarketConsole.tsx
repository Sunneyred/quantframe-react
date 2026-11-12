import { Button, NumberInput, TextInput } from "@mantine/core";
import type { MarketStar, OrderBook, PriceHistory } from "@api/market";
import { useMemo, useState } from "react";
import { addStockItem, addWish, errorText, listForSale } from "../../station/data/bridge";
import type { ShopData } from "../../station/engine/shop";
import { RivenCard, StockCard, WishCard } from "../../station/ui/Shop";
import type { MarketResult } from "../market/data";
import { sellCandidate } from "../market/data";
import { CONSTELLATIONS, filterActive, isMine, matchesFilter, plat, trendText, type MarketFilter } from "../market/layout";
import { Frame } from "./Frame";

/**
 * The Market Console beside the Order Spire: search (flies the focus to any item), the filter row
 * that dims the sky, and for the focused item its numbers, its order book summary and the actions
 * the app already has for it: add to stock or list an owned copy (as Sell Finder does), add to the
 * wish list, and the station's own stock / riven / wish cards when the item is already yours.
 */

const TREND_CSS: Record<string, string> = { rising: "#ffc861", falling: "#9d9cff", flat: "#e8f0ff", unknown: "#8a96a8" };
const STATUS_CSS: Record<string, string> = { ingame: "#5df2b8", online: "#ffd36b", offline: "#7d8799" };

function Flags({ s }: { s: MarketStar }) {
  return (
    <>
      {s.flags.live_order && <span className="vtg-chip is-gold">Live order</span>}
      {s.flags.stock && <span className="vtg-chip">In stock</span>}
      {s.flags.wish && <span className="vtg-chip" style={{ color: "#b78cff" }}>Wish list</span>}
      {s.flags.inventory && <span className="vtg-chip" style={{ color: "#d6ecff" }}>Owned{s.owned ? ` x${s.owned}` : ""}</span>}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="vtg-mstat">
      <span className="vtg-label">{label}</span>
      <b style={{ color }}>{value}</b>
    </div>
  );
}

function Toggle({ on, onClick, children, ...rest }: { on: boolean; onClick: () => void; children: React.ReactNode } & Record<string, unknown>) {
  return (
    <button type="button" className={`vtg-pill ${on ? "is-on" : ""}`} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

function AddToStock({ s, demo, onChanged }: { s: MarketStar; demo: boolean; onChanged: () => void }) {
  const [qty, setQty] = useState<string | number>(1);
  const [paid, setPaid] = useState<string | number>(Math.round(s.median || s.avg_price));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = (v: string | number, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const sub = s.variant.startsWith("r") ? { rank: 0 } : s.variant ? { variant: s.variant } : undefined;
  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };
  const listOwned = async () => {
    const c = await sellCandidate(s.wfm_url);
    if (!c) throw new Error("This item is not in the Sell Finder (no owned copy priced at 5p or more).");
    await listForSale(c, Math.min(c.quantity, Math.max(1, n(qty, 1))));
  };
  return (
    <div className="vtg-mbox" data-vtg-market-actions>
      <span className="vtg-label">Act on it</span>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 6 }}>
        <NumberInput label="Quantity" size="xs" w={90} min={1} allowDecimal={false} value={qty} onChange={setQty} data-vtg-market-qty />
        <NumberInput label="Paid each" size="xs" w={110} min={0} allowDecimal={false} suffix="p" value={paid} onChange={setPaid} />
        <Button size="xs" loading={busy === "stock"} disabled={busy !== null} onClick={() => void run("stock", () => addStockItem(s.wfm_url, s.name, n(qty, 1), n(paid, 0), sub), `Added ${n(qty, 1)} x ${s.name} to stock.`)} data-vtg-market-add-stock>
          Add to stock
        </Button>
        {s.flags.inventory && (
          <Button size="xs" color="teal" variant="light" loading={busy === "list"} disabled={busy !== null} onClick={() => void run("list", listOwned, `Listed ${s.name} from your inventory (0p cost).`)} data-vtg-market-list>
            List owned
          </Button>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 8 }}>
        <Button
          size="xs"
          variant="light"
          color="violet"
          loading={busy === "wish"}
          disabled={busy !== null || s.flags.wish}
          onClick={() => void run("wish", () => addWish(s.wfm_url, s.name, n(qty, 1), n(paid, 0) || undefined, sub), `${s.name} is on your wish list (max ${plat(n(paid, 0))}).`)}
          data-vtg-market-add-wish
        >
          {s.flags.wish ? "On your wish list" : "Add to wish list (max = paid each)"}
        </Button>
        {demo && <span className="vtg-dim" style={{ fontSize: 14 }}>demo: changes stay in this page</span>}
      </div>
      {msg && (
        <div style={{ marginTop: 8, fontSize: 16, color: msg.ok ? "#5df2b8" : "#ff8a8a" }} data-vtg-market-msg>
          {msg.text}
        </div>
      )}
    </div>
  );
}

function BookSummary({ book, loading, error, onRefresh, onVariant }: { book: OrderBook | null; loading: boolean; error: string | null; onRefresh: () => void; onVariant: (v: string) => void }) {
  const s = book?.summary;
  return (
    <div className="vtg-mbox" data-vtg-market-book>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="vtg-label">Order book</span>
        {book && (
          <span className="vtg-dim" style={{ fontSize: 14 }}>
            {book.sells.length} sell · {book.buys.length} buy · read {book.age_secs > 0 ? `${book.age_secs}s ago` : "just now"}
          </span>
        )}
        <Button size="compact-xs" variant="subtle" ml="auto" loading={loading} onClick={onRefresh} data-vtg-market-refresh>
          Refresh
        </Button>
      </div>
      {error && <div style={{ color: "#ff8a8a", fontSize: 15, marginTop: 4 }}>{error}</div>}
      {!book && !error && <div className="vtg-dim" style={{ marginTop: 6 }}>{loading ? "Reading warframe.market..." : "No book yet."}</div>}
      {book && s && (
        <>
          <div className="vtg-mgrid" style={{ marginTop: 6 }}>
            <Stat label="Best sell (in game)" value={plat(s.best_sell_ingame)} color="#7fe8f5" />
            <Stat label="Best buy (in game)" value={plat(s.best_buy_ingame)} color="#c3a8ff" />
            <Stat label="Spread" value={s.spread === null ? "-" : plat(s.spread)} color="#fff1cf" />
            <Stat label="In game now" value={`${s.sellers_ingame} sell · ${s.buyers_ingame} buy`} />
          </div>
          {s.own_sell !== null && (
            <div style={{ marginTop: 8, fontSize: 18, color: s.undercut_by ? "#ff8a96" : "#ffd36b" }} data-vtg-market-own>
              Your sell order: {plat(s.own_sell)} · {s.undercut_by ? `undercut by ${plat(s.undercut_by)}` : "the best in game"}
            </div>
          )}
          {book.variants.length > 1 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {book.variants.map((v) => (
                <Toggle key={v.key} on={v.key === book.variant} onClick={() => onVariant(v.key)}>
                  {v.label} <span className="vtg-dim">({v.sells})</span>
                </Toggle>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 18, marginTop: 8, fontSize: 15 }}>
            <div style={{ flex: 1 }}>
              {book.sells.slice(0, 4).map((o) => (
                <div key={o.id} style={{ display: "flex", gap: 8, color: o.own ? "#ffd36b" : undefined }}>
                  <b style={{ width: 52, color: o.own ? "#ffd36b" : "#7fe8f5" }}>{plat(o.platinum)}</b>
                  <span className="vtg-dim">x{o.quantity}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.own ? "you" : o.user}</span>
                  <span style={{ color: STATUS_CSS[o.status] }}>{o.status === "ingame" ? "in game" : o.status}</span>
                </div>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              {book.buys.slice(0, 4).map((o) => (
                <div key={o.id} style={{ display: "flex", gap: 8 }}>
                  <b style={{ width: 52, color: "#c3a8ff" }}>{plat(o.platinum)}</b>
                  <span className="vtg-dim">x{o.quantity}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.own ? "you" : o.user}</span>
                  <span style={{ color: STATUS_CSS[o.status] }}>{o.status === "ingame" ? "in game" : o.status}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function MarketConsole({
  market,
  shop,
  focus,
  book,
  bookLoading,
  bookError,
  history,
  filter,
  docked,
  onFilter,
  onFocus,
  onRefresh,
  onVariant,
  onChanged,
  onMore,
  onDisengage,
}: {
  market: MarketResult | null;
  shop: ShopData | null;
  focus: MarketStar | null;
  book: OrderBook | null;
  bookLoading: boolean;
  bookError: string | null;
  history: PriceHistory | null;
  filter: MarketFilter;
  docked: boolean;
  onFilter: (f: MarketFilter) => void;
  onFocus: (s: MarketStar) => void;
  onRefresh: () => void;
  onVariant: (v: string) => void;
  onChanged: () => void;
  onMore: () => void;
  onDisengage: () => void;
}) {
  const [query, setQuery] = useState("");
  const items = market?.overview.items ?? [];
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items.filter(isMine);
    return base.sort((a, b) => (q ? Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) : 0) || b.volume - a.volume).slice(0, 60);
  }, [items, query]);
  const matching = useMemo(() => (filterActive(filter) ? items.filter((i) => matchesFilter(i, filter)).length : items.length), [items, filter]);
  const stockItem = focus && !focus.flags.riven ? (shop?.items.find((i) => i.wfm_url === focus.wfm_url) ?? null) : null;
  const stockRiven = focus?.flags.riven ? (shop?.rivens.find((r) => focus.wfm_url === r.wfm_weapon_url || focus.wfm_url === `${r.wfm_weapon_url}_riven`) ?? null) : null;
  const wish = focus ? (shop?.wishes.find((w) => w.wfm_url === focus.wfm_url) ?? null) : null;
  const [card, setCard] = useState<"stock" | "wish" | null>(null);
  const demo = market?.demo ?? true;
  const set = (patch: Partial<MarketFilter>) => onFilter({ ...filter, ...patch });

  return (
    <Frame
      title="Market Console"
      status={
        <>
          {demo && <span className="vtg-chip is-warn">Demo data</span>}
          {market?.error && <span className="vtg-chip is-warn">Overview failed</span>}
          <span className="vtg-chip">{items.length.toLocaleString()} stars</span>
          {filterActive(filter) && <span className="vtg-chip is-gold">{matching.toLocaleString()} match</span>}
        </>
      }
      onDisengage={onDisengage}
      hint={docked ? undefined : <span className="vtg-pulse">Look here and press E to engage</span>}
    >
      <div style={{ width: 420, borderRight: "1px solid rgba(42,212,230,0.2)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "10px 12px 6px" }}>
          <TextInput size="sm" placeholder="Search any item: the focus flies to it" value={query} onChange={(e) => setQuery(e.currentTarget.value)} data-vtg-market-search />
        </div>
        <div className="vtg-filters" data-vtg-market-filters>
          <Toggle on={filter.category === ""} onClick={() => set({ category: "" })}>
            All
          </Toggle>
          {CONSTELLATIONS.map((c) => (
            <Toggle key={c.key} on={filter.category === c.key} onClick={() => set({ category: filter.category === c.key ? "" : c.key })} data-vtg-filter={c.key}>
              {c.label}
            </Toggle>
          ))}
          <Toggle on={filter.mine} onClick={() => set({ mine: !filter.mine })} data-vtg-filter="mine">
            Only my items
          </Toggle>
          <Toggle on={filter.rising} onClick={() => set({ rising: !filter.rising })} data-vtg-filter="rising">
            Only rising
          </Toggle>
        </div>
        <div className="vtg-label" style={{ padding: "6px 14px" }}>
          {query.trim() ? `${results.length} found` : "Your items"}
        </div>
        <div className="vtg-list" style={{ flex: 1 }} data-vtg-market-results>
          {market?.error && <div style={{ padding: 14, color: "#ff8a8a" }}>{market.error}</div>}
          {!market && <div className="vtg-dim" style={{ padding: 14 }}>Charting the market...</div>}
          {market && results.length === 0 && <div className="vtg-dim" style={{ padding: 14 }}>{query.trim() ? "No item matches." : "None of your items has market data."}</div>}
          {results.map((s) => (
            <button key={`${s.flags.riven ? "r" : "i"}:${s.wfm_url}`} type="button" className={`vtg-row ${focus?.wfm_url === s.wfm_url ? "is-active" : ""}`} style={{ fontSize: 16, padding: "6px 12px" }} onClick={() => onFocus(s)} data-vtg-market-item={s.name}>
              <span className="vtg-dot" style={{ background: TREND_CSS[s.trend_dir], color: TREND_CSS[s.trend_dir] }} />
              <span className="vtg-grow">{s.name}</span>
              <span style={{ width: 54, textAlign: "right", color: "#ffd36b", fontWeight: 700 }}>{plat(s.median || s.avg_price)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="vtg-list" style={{ flex: 1, minWidth: 0, padding: "12px 18px" }} data-vtg-market-detail>
        {!focus ? (
          <div style={{ textAlign: "center", marginTop: 120 }}>
            <div className="vtg-big" style={{ fontSize: 30 }}>
              No star in focus
            </div>
            <div className="vtg-dim" style={{ fontSize: 18, marginTop: 12 }}>
              Look at a star in the Orrery and press E, or search for an item on the left.
            </div>
            {market && <div className="vtg-dim" style={{ fontSize: 15, marginTop: 22, maxWidth: 560, marginInline: "auto" }}>Trend: {market.overview.trend_basis}</div>}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "Orbitron, sans-serif", fontSize: 24, color: "#9ff3ff", letterSpacing: "0.04em" }} data-vtg-market-focus>
                {focus.name}
              </span>
              <span className="vtg-dim" style={{ textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 13 }}>
                {focus.category}
              </span>
              <Flags s={focus} />
            </div>
            <div className="vtg-mgrid" style={{ marginTop: 10 }}>
              <Stat label="Average" value={plat(focus.avg_price)} color="#ffe39a" />
              <Stat label="Median" value={plat(focus.median)} />
              <Stat label="Min - max" value={`${plat(focus.min_price)} - ${plat(focus.max_price)}`} />
              <Stat label={focus.flags.riven ? "Auctions" : "Trades / day"} value={String(focus.volume)} color="#7fe8f5" />
              <Stat label="Trend" value={trendText(focus)} color={TREND_CSS[focus.trend_dir]} />
              <Stat label="Profit margin" value={focus.profit_margin ? plat(focus.profit_margin) : "-"} />
            </div>
            {history && (
              <div className="vtg-dim" style={{ fontSize: 14, marginTop: 6 }} data-vtg-market-history>
                Ribbon: {history.note}
              </div>
            )}
            <BookSummary book={book} loading={bookLoading} error={bookError} onRefresh={onRefresh} onVariant={onVariant} />
            {stockItem && card === "stock" ? (
              <StockCard key={stockItem.id} item={stockItem} demo={demo} onChanged={onChanged} onMore={onMore} onClose={() => setCard(null)} closeLabel="Close" />
            ) : stockRiven && card === "stock" ? (
              <RivenCard key={stockRiven.id} riven={stockRiven} demo={demo} onChanged={onChanged} onMore={onMore} onClose={() => setCard(null)} closeLabel="Close" />
            ) : wish && card === "wish" ? (
              <WishCard key={wish.id} wish={wish} demo={demo} onChanged={onChanged} onMore={onMore} onClose={() => setCard(null)} closeLabel="Close" />
            ) : (
              <>
                {(stockItem || stockRiven || wish) && (
                  <div className="vtg-mbox" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="vtg-label">Yours</span>
                    {(stockItem || stockRiven) && (
                      <Button size="xs" variant="light" onClick={() => setCard("stock")} data-vtg-market-open-stock>
                        Open stock actions{stockItem ? ` (${stockItem.owned} in stock)` : ""}
                      </Button>
                    )}
                    {wish && (
                      <Button size="xs" variant="light" color="violet" onClick={() => setCard("wish")} data-vtg-market-open-wish>
                        Open wish list entry
                      </Button>
                    )}
                  </div>
                )}
                {focus.flags.riven ? (
                  <div className="vtg-mbox vtg-dim">Rivens are added to stock from the Rivens page (they need their rolls).</div>
                ) : (
                  <AddToStock key={focus.wfm_url} s={focus} demo={demo} onChanged={onChanged} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </Frame>
  );
}
