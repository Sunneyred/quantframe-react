import { Button, Group, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { useMemo, useState } from "react";
import { copyText, errorText, sellStockItem } from "../../station/data/bridge";
import { inviteCommand, whisperCommand, type Buyer } from "../../station/engine/logic";
import { matchOffer, statusCss, subTypeText, type StockItem } from "../../station/engine/shop";
import { fmt, Frame } from "./Frame";

/**
 * The Trade Desk terminal: the buyer queue and, for the selected buyer, the station customer
 * card's actions (copy whisper / invite, record the sale against a stock item, send them off),
 * using the same logic (`whisperCommand`, `inviteCommand`, `matchOffer`, `sellStockItem`).
 */

const SOURCE: Record<string, string> = { debug: "Debug buyer", whisper: "In-game whisper", wfm_chat: "warframe.market chat" };

function CopyCommand({ label, command }: { label: string; command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const ok = await copyText(command);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1600);
  };
  return (
    <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
      <Button size="sm" variant={state === "copied" ? "filled" : "light"} color={state === "failed" ? "red" : "cyan"} onClick={copy} data-vtg-copy={label}>
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      </Button>
      <span className="vtg-cmd">{command}</span>
    </Stack>
  );
}

function SaleForm({ buyer, items, onChanged }: { buyer: Buyer; items: StockItem[]; onChanged: () => void }) {
  const guess = useMemo(() => matchOffer(buyer.message, items), [buyer.message, items]);
  const [id, setId] = useState<number | null>(guess.item?.id ?? null);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<string | number>(1);
  const [price, setPrice] = useState<string | number>(guess.price ?? guess.item?.list_price ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const item = items.find((i) => i.id === id) ?? null;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => !q || i.item_name.toLowerCase().includes(q)).slice(0, 40);
  }, [items, search]);
  if (items.length === 0) return <Text className="vtg-dim">Nothing in stock to record a sale against.</Text>;
  const num = (v: string | number, f = 0) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  const count = Math.max(1, Math.min(item?.owned ?? 1, Math.floor(num(qty, 1)) || 1));
  const each = Math.max(0, Math.floor(num(price)));
  const record = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await sellStockItem(item, each, count);
      setDone(`Sale recorded: ${count} x ${item.item_name} for ${fmt(each)}p each.`);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 14, minHeight: 0, flex: 1 }} data-vtg-sale>
      <div style={{ width: 300, display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid rgba(42,212,230,0.2)" }}>
        <TextInput size="xs" placeholder="Search stock" value={search} onChange={(e) => setSearch(e.currentTarget.value)} data-vtg-sale-search />
        <div className="vtg-list" style={{ flex: 1 }}>
          {shown.map((i) => {
            const sub = subTypeText(i.sub_type);
            return (
              <button
                key={i.id}
                type="button"
                className={`vtg-row ${i.id === id ? "is-active" : ""}`}
                style={{ fontSize: 15, padding: "5px 10px" }}
                onClick={() => {
                  setId(i.id);
                  if (i.list_price && (price === "" || price === 0)) setPrice(i.list_price);
                }}
                data-vtg-sale-item={i.id}
              >
                <span className="vtg-dot" style={{ background: statusCss(i.status), color: statusCss(i.status) }} />
                <span className="vtg-grow">
                  {i.item_name}
                  {sub ? ` (${sub})` : ""}
                </span>
                <span className="vtg-dim">x{i.owned}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
        <span className="vtg-label">Sold item</span>
        <Text fz={20} fw={700} c={item ? "#ffe39a" : "dimmed"} lineClamp={2}>
          {item ? item.item_name : "Pick the stock item they bought"}
        </Text>
        {guess.item && item?.id === guess.item.id && <Text fz={14} c="cyan.3">Matched from their message.</Text>}
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput label="Quantity" size="sm" w={110} min={1} max={item?.owned ?? 1} allowDecimal={false} value={qty} onChange={setQty} data-vtg-qty />
          <NumberInput label="Sold for (each)" size="sm" w={150} min={0} allowDecimal={false} suffix="p" value={price} onChange={setPrice} data-vtg-price />
        </Group>
        <Button color="yellow" size="sm" disabled={!item || busy} loading={busy} onClick={record} data-vtg-record>
          Record sale{item ? ` · ${fmt(each * count)}p` : ""}
        </Button>
        {error && (
          <Text c="red.4" fz={15} data-vtg-error>
            {error}
          </Text>
        )}
        {done && (
          <Text c="teal.3" fz={15} data-vtg-done>
            {done}
          </Text>
        )}
      </Stack>
    </div>
  );
}

export function DeskScreen({
  queue,
  selected,
  items,
  docked,
  onSelect,
  onDismiss,
  onChanged,
  onDisengage,
}: {
  queue: Buyer[];
  selected: string | null;
  items: StockItem[];
  docked: boolean;
  onSelect: (id: string) => void;
  onDismiss: (id: string) => void;
  onChanged: () => void;
  onDisengage: () => void;
}) {
  const buyer = queue.find((b) => b.id === selected) ?? null;
  return (
    <Frame
      title="Trade Desk"
      status={<span className={`vtg-chip ${queue.length ? "is-gold" : ""}`}>{queue.length ? `${queue.length} waiting` : "Quiet"}</span>}
      onDisengage={onDisengage}
      hint={docked ? undefined : <span className="vtg-pulse">Look here and press E to engage</span>}
    >
      <div style={{ width: 280, borderRight: "1px solid rgba(42,212,230,0.2)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="vtg-label" style={{ padding: "10px 14px 6px" }}>
          Queue
        </div>
        <div className="vtg-list" style={{ flex: 1 }} data-vtg-queue>
          {queue.length === 0 && <div style={{ padding: "8px 14px", fontSize: 17 }} className="vtg-dim">Nobody is waiting. A trader walks in when a buyer messages you.</div>}
          {queue.map((b, i) => (
            <button key={b.id} type="button" className={`vtg-row ${b.id === selected ? "is-active" : ""}`} onClick={() => onSelect(b.id)} data-vtg-buyer={b.name}>
              <span className="vtg-n">{String(i + 1).padStart(2, "0")}</span>
              <span className="vtg-grow">{b.name}</span>
              {b.pings > 1 && <span className="vtg-chip">{b.pings}</span>}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        {!buyer ? (
          <div style={{ margin: "auto", textAlign: "center" }}>
            <div className="vtg-big" style={{ fontSize: 34 }}>
              {queue.length ? "Select a buyer" : "Desk open"}
            </div>
            <div className="vtg-dim" style={{ marginTop: 10, fontSize: 18 }}>
              Buyers from warframe.market chat and in-game whispers queue here.
            </div>
          </div>
        ) : (
          <>
            <Group justify="space-between" wrap="nowrap">
              <div className="vtg-big" style={{ fontSize: 30, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-vtg-selected>
                {buyer.name}
              </div>
              <span className={`vtg-chip ${buyer.source === "debug" ? "is-warn" : ""}`}>{SOURCE[buyer.source] ?? buyer.source}</span>
            </Group>
            {buyer.message ? <div className="vtg-quote">{buyer.message}</div> : <div className="vtg-dim">No message text came with this event.</div>}
            <Group gap="md" className="vtg-dim" style={{ fontSize: 15 }}>
              <span>Received {new Date(buyer.receivedAt).toLocaleTimeString()}</span>
              {buyer.pings > 1 && <span>{buyer.pings} messages</span>}
              {buyer.reputation !== undefined && <span>Reputation {buyer.reputation}</span>}
              {buyer.status && <span>Status {buyer.status}</span>}
            </Group>
            {buyer.commandName ? (
              <Group gap="md" wrap="nowrap" align="flex-start">
                <CopyCommand label="Copy whisper" command={whisperCommand(buyer.commandName)} />
                <CopyCommand label="Copy invite" command={inviteCommand(buyer.commandName)} />
              </Group>
            ) : (
              <Text c="orange.4" fz={16}>
                The event did not include this player's in-game name, so there is no command to copy.
              </Text>
            )}
            <span className="vtg-label" style={{ marginTop: 4 }}>
              Record the sale
            </span>
            <SaleForm key={buyer.id} buyer={buyer} items={items} onChanged={onChanged} />
            <Group justify="flex-end">
              <Button variant="default" size="sm" onClick={() => onDismiss(buyer.id)} data-vtg-dismiss>
                Done, send them off
              </Button>
            </Group>
          </>
        )}
      </div>
    </Frame>
  );
}
