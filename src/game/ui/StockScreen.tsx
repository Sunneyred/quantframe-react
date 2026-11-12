import { TextInput } from "@mantine/core";
import { useMemo, useState } from "react";
import type { ShopData } from "../../station/engine/shop";
import { byShelfOrder, statusCss, statusText, subTypeText } from "../../station/engine/shop";
import { StockCard } from "../../station/ui/Shop";
import { fmt, Frame } from "./Frame";

/** The Stock Display: the stock list, and the station's own stock card (sell, edit, hide, delete) for the picked item. */
export function StockScreen({ shop, docked, onChanged, onMore, onDisengage }: { shop: ShopData | null; docked: boolean; onChanged: () => void; onMore: () => void; onDisengage: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (shop?.items ?? []).filter((i) => !q || i.item_name.toLowerCase().includes(q)).sort(byShelfOrder);
  }, [shop, search]);
  const item = shop?.items.find((i) => i.id === picked) ?? null;
  const live = shop?.items.filter((i) => i.status === "live" && !i.is_hidden).length ?? 0;
  const listed = shop?.items.reduce((s, i) => s + (i.list_price && !i.is_hidden ? i.list_price * i.owned : 0), 0) ?? 0;
  return (
    <Frame
      title="Stock Display"
      status={
        <>
          {shop?.demo && <span className="vtg-chip is-warn">Demo data</span>}
          <span className="vtg-chip is-ok">{live} live</span>
          <span className="vtg-chip is-gold">{fmt(listed)}p listed</span>
        </>
      }
      onDisengage={onDisengage}
      hint={docked ? undefined : <span className="vtg-pulse">Look here and press E to engage</span>}
    >
      <div style={{ width: 470, borderRight: "1px solid rgba(42,212,230,0.2)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "10px 12px" }}>
          <TextInput size="sm" placeholder="Search stock items" value={search} onChange={(e) => setSearch(e.currentTarget.value)} data-vtg-stock-search />
        </div>
        <div className="vtg-list" style={{ flex: 1 }} data-vtg-stock-list>
          {!shop && <div className="vtg-dim" style={{ padding: 14 }}>Reading the stock...</div>}
          {shop?.error && <div style={{ padding: 14, color: "#ff8a8a" }}>{shop.error}</div>}
          {shop && items.length === 0 && !shop.error && <div className="vtg-dim" style={{ padding: 14 }}>No stock items.</div>}
          {items.map((i) => {
            const sub = subTypeText(i.sub_type);
            return (
              <button key={i.id} type="button" className={`vtg-row ${i.id === picked ? "is-active" : ""}`} onClick={() => setPicked(i.id)} data-vtg-stock-item={i.item_name} style={{ opacity: i.is_hidden ? 0.55 : 1 }}>
                <span className="vtg-dot" style={{ background: statusCss(i.status), color: statusCss(i.status) }} />
                <span className="vtg-grow">
                  {i.item_name}
                  {sub ? ` (${sub})` : ""}
                </span>
                <span className="vtg-dim" style={{ width: 34, textAlign: "right" }}>
                  x{i.owned}
                </span>
                <span style={{ width: 64, textAlign: "right", color: "#ffd36b", fontWeight: 700 }}>{i.list_price ? `${fmt(i.list_price)}p` : "-"}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: "14px 18px", overflowY: "auto" }} className="vtg-list">
        {item ? (
          <StockCard key={item.id} item={item} demo={!!shop?.demo} onChanged={onChanged} onMore={onMore} onClose={() => setPicked(null)} closeLabel="Close" />
        ) : picked !== null ? (
          <div className="vtg-dim" style={{ fontSize: 18 }}>
            That item is no longer in stock.
          </div>
        ) : (
          <div style={{ textAlign: "center", marginTop: 160 }}>
            <div className="vtg-big" style={{ fontSize: 30 }}>
              {shop ? `${shop.totalItems} stock items` : "..."}
            </div>
            <div className="vtg-dim" style={{ fontSize: 18, marginTop: 10 }}>
              Pick an item to record a sale, edit it, hide it from the trader or delete it.
            </div>
            <div className="vtg-dim" style={{ fontSize: 16, marginTop: 18 }}>
              {Object.entries(
                (shop?.items ?? []).reduce<Record<string, number>>((acc, i) => {
                  acc[i.status] = (acc[i.status] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([s, n]) => (
                <span key={s} style={{ marginRight: 14, color: statusCss(s) }}>
                  {statusText(s)} {n}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}
