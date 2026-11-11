import { Alert, Badge, Button, Card, Group, NumberInput, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { boughtWish, deleteStockItem, deleteStockRiven, deleteWish, errorText, sellStockItem, sellStockRiven, updateStockItem, updateStockRiven, updateWish } from "../data/bridge";
import type { Buyer } from "../engine/logic";
import { matchOffer, rivenName, statusCss, statusDetail, statusText, subTypeText, type StockItem, type StockRiven, type WishItem } from "../engine/shop";

const fmt = (n: number) => Math.round(n).toLocaleString();
const num = (v: string | number, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Runs one backend action at a time and keeps its outcome for the card to show. */
function useAction(onChanged: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>, message: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
      onChanged();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, done, run };
}

function StatusBadge({ status, hidden }: { status: string; hidden: boolean }) {
  return (
    <Group gap={6} wrap="nowrap">
      {hidden && (
        <Badge color="gray" variant="light">
          Hidden
        </Badge>
      )}
      <Badge variant="outline" style={{ color: statusCss(status), borderColor: statusCss(status) }} data-station-status={status}>
        {statusText(status)}
      </Badge>
    </Group>
  );
}

function Outcome({ error, done }: { error: string | null; done: string | null }) {
  return (
    <>
      {error && (
        <Alert color="red" p="xs" title="That did not go through" data-station-error>
          {error}
        </Alert>
      )}
      {done && (
        <Alert color="teal" p="xs" data-station-done-note>
          {done}
        </Alert>
      )}
    </>
  );
}

function Gone({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <Card className="vt-station-card" p="md" data-station-card="gone">
      <Text size="sm">{what}</Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}

function Fact({ label, children, color }: { label: string; children: ReactNode; color?: string }) {
  return (
    <>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={700} c={color}>
        {children}
      </Text>
    </>
  );
}

/** Two-step delete, so a stray click cannot remove a row. */
function DeleteButton({ busy, onDelete }: { busy: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button size="xs" color="red" variant={armed ? "filled" : "subtle"} loading={busy} onClick={() => (armed ? onDelete() : setArmed(true))} data-station-delete>
      {armed ? "Really delete?" : "Delete"}
    </Button>
  );
}

interface CardProps {
  demo: boolean;
  /** Something changed in the backend: re-read the shop. */
  onChanged: () => void;
  /** Open the full Live Trading page (bulk edit, market info, trade messages). */
  onMore: () => void;
  onClose: () => void;
}

function CardFooter({ onMore, onClose, more }: { onMore: () => void; onClose: () => void; more: string }) {
  return (
    <Group justify="space-between" mt="xs" wrap="nowrap">
      <Button variant="subtle" size="compact-xs" onClick={onMore} data-station-more>
        {more}
      </Button>
      <Button variant="default" size="xs" onClick={onClose}>
        Close (Esc)
      </Button>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Stock item (a sell order on the shelves)
// ---------------------------------------------------------------------------

export function StockCard({ item, demo, onChanged, onMore, onClose }: CardProps & { item: StockItem | null }) {
  const [mode, setMode] = useState("sell");
  const [qty, setQty] = useState<string | number>(1);
  const [price, setPrice] = useState<string | number>(item?.list_price ?? 0);
  const [bought, setBought] = useState<string | number>(item?.bought ?? 0);
  const [owned, setOwned] = useState<string | number>(item?.owned ?? 1);
  const [minPrice, setMinPrice] = useState<string | number>(item?.properties?.min_price ?? "");
  const { busy, error, done, run } = useAction(onChanged);

  if (!item) return <Gone what={done ?? "This item is no longer in stock."} onClose={onClose} />;
  const sub = subTypeText(item.sub_type);
  const count = Math.max(1, Math.min(item.owned, Math.floor(num(qty, 1)) || 1));
  const sellPrice = Math.max(0, Math.floor(num(price)));
  const profit = item.list_price ? (item.list_price - item.bought) * item.owned : null;

  return (
    <Card className="vt-station-card" p="md" data-station-card="stock">
      <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
        <Text className="vt-station-card-title" size="lg" style={{ color: statusCss(item.status) }}>
          {item.item_name}
          {sub ? ` (${sub})` : ""}
        </Text>
        <Group gap={6} wrap="nowrap">
          {demo && (
            <Badge color="orange" variant="light">
              Demo
            </Badge>
          )}
          <StatusBadge status={item.status} hidden={item.is_hidden} />
        </Group>
      </Group>
      <Stack gap="xs">
        <div className="vt-station-facts">
          <Fact label="In stock">{item.owned}</Fact>
          <Fact label="Paid each">{fmt(item.bought)}p</Fact>
          <Fact label="List price" color="yellow.4">
            {item.list_price ? `${fmt(item.list_price)}p` : "not listed"}
          </Fact>
          <Fact label="Minimum price">{item.properties?.min_price ? `${fmt(item.properties.min_price)}p` : "none"}</Fact>
          <Fact label="Profit if all sell" color={profit !== null && profit < 0 ? "red.4" : "teal.4"}>
            {profit !== null ? `${fmt(profit)}p` : "-"}
          </Fact>
          <Fact label="Status">{statusText(item.status)}</Fact>
        </div>
        <Text size="xs" c="dimmed">
          {item.is_hidden ? "Hidden: the trader skips this item until you show it again." : statusDetail(item.status)}
        </Text>
        <SegmentedControl size="xs" value={mode} onChange={setMode} data={[{ label: "Sell", value: "sell" }, { label: "Edit", value: "edit" }]} data-station-mode />
        {mode === "sell" ? (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Quantity" size="xs" w={90} min={1} max={item.owned} allowDecimal={false} value={qty} onChange={setQty} data-station-qty />
              <NumberInput label="Sold for (each)" size="xs" w={120} min={0} allowDecimal={false} suffix="p" value={price} onChange={setPrice} data-station-price />
              <Button
                size="xs"
                loading={busy === "sell"}
                disabled={busy !== null}
                onClick={() => run("sell", () => sellStockItem(item, sellPrice, count), `Sale recorded: ${count} x ${item.item_name} for ${fmt(sellPrice)}p each.`)}
                data-station-sell
              >
                Record sale
              </Button>
            </Group>
            <Button
              size="xs"
              variant="light"
              disabled={!item.list_price || busy !== null}
              loading={busy === "auto"}
              onClick={() => run("auto", () => sellStockItem(item, item.list_price ?? 0, 1), `Sale recorded: 1 x ${item.item_name} at the list price of ${fmt(item.list_price ?? 0)}p.`)}
              data-station-sell-auto
            >
              {item.list_price ? `Sold one at the list price (${fmt(item.list_price)}p)` : "No list price yet"}
            </Button>
          </>
        ) : (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Paid each" size="xs" w={100} min={0} allowDecimal={false} suffix="p" value={bought} onChange={setBought} />
              <NumberInput label="In stock" size="xs" w={90} min={1} allowDecimal={false} value={owned} onChange={setOwned} />
              <NumberInput label="Minimum price" size="xs" w={120} min={0} allowDecimal={false} suffix="p" placeholder="none" value={minPrice} onChange={setMinPrice} />
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                loading={busy === "save"}
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "save",
                    // 0 clears the minimum price, exactly like the stock table
                    () => updateStockItem({ id: item.id, bought: Math.max(0, Math.floor(num(bought))), owned: Math.max(1, Math.floor(num(owned, 1))), properties: { min_price: Math.max(0, Math.floor(num(minPrice))) }, list_price: item.list_price }),
                    "Saved.",
                  )
                }
                data-station-save
              >
                Save
              </Button>
              <Button
                size="xs"
                variant="light"
                loading={busy === "hide"}
                disabled={busy !== null}
                onClick={() => run("hide", () => updateStockItem({ id: item.id, is_hidden: !item.is_hidden, list_price: item.list_price }), item.is_hidden ? "Shown again: the trader will list it." : "Hidden: the trader will skip it.")}
                data-station-hide
              >
                {item.is_hidden ? "Show to the trader" : "Hide from the trader"}
              </Button>
              <DeleteButton busy={busy === "delete"} onDelete={() => void run("delete", () => deleteStockItem(item.id), `${item.item_name} was removed from stock.`)} />
            </Group>
            <Text size="xs" c="dimmed">
              The list price is set by the live trader from the market; a minimum price is the floor it may not go under.
            </Text>
          </>
        )}
        <Outcome error={error} done={done} />
        <CardFooter onMore={onMore} onClose={onClose} more="Market info, bulk edit: stock desk" />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stock riven (display case)
// ---------------------------------------------------------------------------

export function RivenCard({ riven, demo, onChanged, onMore, onClose }: CardProps & { riven: StockRiven | null }) {
  const [mode, setMode] = useState("sell");
  const [price, setPrice] = useState<string | number>(riven?.list_price ?? 0);
  const [bought, setBought] = useState<string | number>(riven?.bought ?? 0);
  const [minPrice, setMinPrice] = useState<string | number>(riven?.properties?.min_price ?? "");
  const { busy, error, done, run } = useAction(onChanged);

  if (!riven) return <Gone what={done ?? "This riven is no longer in stock."} onClose={onClose} />;
  const sellPrice = Math.max(0, Math.floor(num(price)));
  const name = rivenName(riven);

  return (
    <Card className="vt-station-card" p="md" data-station-card="riven">
      <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
        <Text className="vt-station-card-title" size="lg" style={{ color: "#d9c2ff" }}>
          {name}
        </Text>
        <Group gap={6} wrap="nowrap">
          {demo && (
            <Badge color="orange" variant="light">
              Demo
            </Badge>
          )}
          <StatusBadge status={riven.status} hidden={riven.is_hidden} />
        </Group>
      </Group>
      <Stack gap="xs">
        <div className="vt-station-facts">
          <Fact label="Paid">{fmt(riven.bought)}p</Fact>
          <Fact label="List price" color="yellow.4">
            {riven.list_price ? `${fmt(riven.list_price)}p` : "not listed"}
          </Fact>
          <Fact label="Mastery">MR {riven.mastery_rank}</Fact>
          <Fact label="Rerolls">{riven.re_rolls}</Fact>
          <Fact label="Rank">{riven.sub_type?.rank ?? 0}</Fact>
          <Fact label="Polarity">{riven.polarity || "-"}</Fact>
        </div>
        {riven.attributes?.length > 0 && (
          <Group gap={6}>
            {riven.attributes.map((a, i) => (
              <Badge key={i} size="sm" variant="light" color={a.positive ? "teal" : "red"}>
                {a.positive ? "+" : "-"}
                {Math.abs(a.value)} {(a.url_name ?? a.wfmUrl ?? "").replace(/_/g, " ")}
              </Badge>
            ))}
          </Group>
        )}
        <Text size="xs" c="dimmed">
          {riven.is_hidden ? "Hidden: the trader skips this riven until you show it again." : statusDetail(riven.status)}
        </Text>
        <SegmentedControl size="xs" value={mode} onChange={setMode} data={[{ label: "Sell", value: "sell" }, { label: "Edit", value: "edit" }]} />
        {mode === "sell" ? (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Sold for" size="xs" w={130} min={0} allowDecimal={false} suffix="p" value={price} onChange={setPrice} data-station-price />
              <Button size="xs" loading={busy === "sell"} disabled={busy !== null} onClick={() => run("sell", () => sellStockRiven(riven, sellPrice), `Sale recorded: ${name} for ${fmt(sellPrice)}p.`)} data-station-sell>
                Record sale
              </Button>
            </Group>
            <Button
              size="xs"
              variant="light"
              disabled={!riven.list_price || busy !== null}
              loading={busy === "auto"}
              onClick={() => run("auto", () => sellStockRiven(riven, riven.list_price ?? 0), `Sale recorded: ${name} at the list price of ${fmt(riven.list_price ?? 0)}p.`)}
            >
              {riven.list_price ? `Sold at the list price (${fmt(riven.list_price)}p)` : "No list price yet"}
            </Button>
          </>
        ) : (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Paid" size="xs" w={110} min={0} allowDecimal={false} suffix="p" value={bought} onChange={setBought} />
              <NumberInput label="Minimum price" size="xs" w={130} min={0} allowDecimal={false} suffix="p" placeholder="none" value={minPrice} onChange={setMinPrice} />
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                loading={busy === "save"}
                disabled={busy !== null}
                onClick={() => run("save", () => updateStockRiven({ id: riven.id, bought: Math.max(0, Math.floor(num(bought))), properties: { min_price: Math.max(0, Math.floor(num(minPrice))) } }), "Saved.")}
                data-station-save
              >
                Save
              </Button>
              <Button
                size="xs"
                variant="light"
                loading={busy === "hide"}
                disabled={busy !== null}
                onClick={() => run("hide", () => updateStockRiven({ id: riven.id, is_hidden: !riven.is_hidden }), riven.is_hidden ? "Shown again: the trader will list it." : "Hidden: the trader will skip it.")}
                data-station-hide
              >
                {riven.is_hidden ? "Show to the trader" : "Hide from the trader"}
              </Button>
              <DeleteButton busy={busy === "delete"} onDelete={() => void run("delete", () => deleteStockRiven(riven.id), `${name} was removed from stock.`)} />
            </Group>
          </>
        )}
        <Outcome error={error} done={done} />
        <CardFooter onMore={onMore} onClose={onClose} more="Match filter, grades, market info: stock desk" />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Wish list entry (wanted poster)
// ---------------------------------------------------------------------------

export function WishCard({ wish, demo, onChanged, onMore, onClose }: CardProps & { wish: WishItem | null }) {
  const [mode, setMode] = useState("buy");
  const [qty, setQty] = useState<string | number>(1);
  const [price, setPrice] = useState<string | number>(wish?.list_price ?? 0);
  const [quantity, setQuantity] = useState<string | number>(wish?.quantity ?? 1);
  const [maxPrice, setMaxPrice] = useState<string | number>(wish?.properties?.max_price ?? "");
  const { busy, error, done, run } = useAction(onChanged);

  if (!wish) return <Gone what={done ?? "This entry is no longer on the wish list."} onClose={onClose} />;
  const sub = subTypeText(wish.sub_type);
  const count = Math.max(1, Math.min(wish.quantity, Math.floor(num(qty, 1)) || 1));
  const paid = Math.max(0, Math.floor(num(price)));

  return (
    <Card className="vt-station-card" p="md" data-station-card="wish">
      <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
        <Stack gap={0}>
          <Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: "0.2em" }}>
            Wanted
          </Text>
          <Text className="vt-station-card-title" size="lg" style={{ color: statusCss(wish.status) }}>
            {wish.item_name}
            {sub ? ` (${sub})` : ""}
          </Text>
        </Stack>
        <Group gap={6} wrap="nowrap">
          {demo && (
            <Badge color="orange" variant="light">
              Demo
            </Badge>
          )}
          <StatusBadge status={wish.status} hidden={wish.is_hidden} />
        </Group>
      </Group>
      <Stack gap="xs">
        <div className="vt-station-facts">
          <Fact label="Still wanted">{wish.quantity}</Fact>
          <Fact label="Maximum price">{wish.properties?.max_price ? `${fmt(wish.properties.max_price)}p` : "none"}</Fact>
          <Fact label="Your buy order" color="yellow.4">
            {wish.list_price ? `${fmt(wish.list_price)}p` : "not posted"}
          </Fact>
          <Fact label="Status">{statusText(wish.status)}</Fact>
        </div>
        <Text size="xs" c="dimmed">
          {wish.is_hidden ? "Hidden: the trader does not post a buy order for it." : statusDetail(wish.status)}
        </Text>
        <SegmentedControl size="xs" value={mode} onChange={setMode} data={[{ label: "Bought", value: "buy" }, { label: "Edit", value: "edit" }]} />
        {mode === "buy" ? (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Quantity" size="xs" w={90} min={1} max={wish.quantity} allowDecimal={false} value={qty} onChange={setQty} />
              <NumberInput label="Paid (each)" size="xs" w={120} min={0} allowDecimal={false} suffix="p" value={price} onChange={setPrice} data-station-price />
              <Button size="xs" loading={busy === "buy"} disabled={busy !== null} onClick={() => run("buy", () => boughtWish(wish, paid, count), `Purchase recorded: ${count} x ${wish.item_name} for ${fmt(paid)}p each.`)} data-station-bought>
                Record purchase
              </Button>
            </Group>
            <Button
              size="xs"
              variant="light"
              disabled={!wish.list_price || busy !== null}
              loading={busy === "auto"}
              onClick={() => run("auto", () => boughtWish(wish, wish.list_price ?? 0, 1), `Purchase recorded: 1 x ${wish.item_name} at ${fmt(wish.list_price ?? 0)}p.`)}
            >
              {wish.list_price ? `Bought one at your order price (${fmt(wish.list_price)}p)` : "No buy order posted yet"}
            </Button>
          </>
        ) : (
          <>
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <NumberInput label="Wanted" size="xs" w={90} min={1} allowDecimal={false} value={quantity} onChange={setQuantity} />
              <NumberInput label="Maximum price" size="xs" w={130} min={0} allowDecimal={false} suffix="p" placeholder="none" value={maxPrice} onChange={setMaxPrice} />
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                loading={busy === "save"}
                disabled={busy !== null}
                onClick={() => run("save", () => updateWish({ id: wish.id, quantity: Math.max(1, Math.floor(num(quantity, 1))), properties: { max_price: Math.max(0, Math.floor(num(maxPrice))) } }), "Saved.")}
                data-station-save
              >
                Save
              </Button>
              <Button
                size="xs"
                variant="light"
                loading={busy === "hide"}
                disabled={busy !== null}
                onClick={() => run("hide", () => updateWish({ id: wish.id, is_hidden: !wish.is_hidden }), wish.is_hidden ? "Shown again: the trader will post a buy order." : "Hidden: no buy order is posted.")}
                data-station-hide
              >
                {wish.is_hidden ? "Show to the trader" : "Hide from the trader"}
              </Button>
              <DeleteButton busy={busy === "delete"} onDelete={() => void run("delete", () => deleteWish(wish.id), `${wish.item_name} was taken off the wish list.`)} />
            </Group>
          </>
        )}
        <Outcome error={error} done={done} />
        <CardFooter onMore={onMore} onClose={onClose} more="Add entries, WTB message: stock desk" />
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recording a sale from the trade desk
// ---------------------------------------------------------------------------

/** "Sell" from the stock table, offered while a customer is at the desk. Pre-fills from the buyer's message when it names an item. */
export function RecordSale({ buyer, items, onChanged }: { buyer: Buyer; items: StockItem[]; onChanged: () => void }) {
  const guess = useMemo(() => matchOffer(buyer.message, items), [buyer.message, items]);
  const [id, setId] = useState<string | null>(guess.item ? String(guess.item.id) : null);
  const [qty, setQty] = useState<string | number>(1);
  const [price, setPrice] = useState<string | number>(guess.price ?? guess.item?.list_price ?? "");
  const { busy, error, done, run } = useAction(onChanged);
  const item = items.find((i) => String(i.id) === id) ?? null;
  const data = useMemo(
    () =>
      items.map((i) => {
        const sub = subTypeText(i.sub_type);
        return { value: String(i.id), label: `${i.item_name}${sub ? ` (${sub})` : ""} · ${i.owned} in stock${i.list_price ? ` · ${i.list_price}p` : ""}` };
      }),
    [items],
  );
  if (items.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        Nothing in stock to record a sale against.
      </Text>
    );
  }
  const count = Math.max(1, Math.min(item?.owned ?? 1, Math.floor(num(qty, 1)) || 1));
  const sellPrice = Math.max(0, Math.floor(num(price)));
  return (
    <Stack gap={6} className="vt-station-sale" data-station-record-sale>
      <Text size="xs" tt="uppercase" c="dimmed" style={{ letterSpacing: "0.14em" }}>
        Record the sale
      </Text>
      <Select
        size="xs"
        searchable
        placeholder="Which stock item did they buy?"
        data={data}
        value={id}
        onChange={(v) => {
          setId(v);
          const next = items.find((i) => String(i.id) === v);
          if (next?.list_price && (price === "" || price === 0)) setPrice(next.list_price);
        }}
        nothingFoundMessage="No stock item matches"
        comboboxProps={{ withinPortal: true }}
      />
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <NumberInput label="Quantity" size="xs" w={90} min={1} max={item?.owned ?? 1} allowDecimal={false} value={qty} onChange={setQty} />
        <NumberInput label="Sold for (each)" size="xs" w={120} min={0} allowDecimal={false} suffix="p" value={price} onChange={setPrice} />
        <Button size="xs" disabled={!item || busy !== null} loading={busy === "sell"} onClick={() => item && run("sell", () => sellStockItem(item, sellPrice, count), `Sale recorded: ${count} x ${item.item_name} for ${fmt(sellPrice)}p each.`)} data-station-sell>
          Record sale
        </Button>
      </Group>
      <Outcome error={error} done={done} />
    </Stack>
  );
}
