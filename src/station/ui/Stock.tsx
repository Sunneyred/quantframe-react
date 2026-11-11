import { Alert, Badge, Button, Card, CloseButton, Group, NumberInput, SegmentedControl, Stack, Table, Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { errorText, type SellResult } from "../data/bridge";
import { BAYS, bayLabel, priceCaveat, summarize, tierOf, topUnlisted, TIER_CSS, type BayKey, type SellCandidate } from "../engine/warehouse";

const fmt = (n: number) => Math.round(n).toLocaleString();

/** Adds an item to stock. Rejects with the reason when the backend refuses. */
export type ListFn = (item: SellCandidate, quantity: number) => Promise<void>;

export function Price({ item }: { item: SellCandidate }) {
  const caveat = priceCaveat(item.basis);
  if (!caveat) return <>{item.unit_price}p</>;
  return (
    <Tooltip label={caveat} multiline w={260}>
      <Text span c="orange.5" inherit>
        ~{item.unit_price}p
      </Text>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Crate card
// ---------------------------------------------------------------------------

export function ItemCard({ item, demo, onList, onClose }: { item: SellCandidate | null; demo: boolean; onList: ListFn; onClose: () => void }) {
  const [qty, setQty] = useState<number>(item?.quantity ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  if (!item) {
    return (
      <Card className="vt-station-card" p="md" data-station-card="item">
        <Text size="sm">This crate is no longer in the warehouse.</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" size="xs" onClick={onClose}>
            Close (Esc)
          </Button>
        </Group>
      </Card>
    );
  }

  const caveat = priceCaveat(item.basis);
  const count = Math.max(1, Math.min(item.quantity, Math.floor(qty) || 1));
  const list = async () => {
    setBusy(true);
    setError(null);
    try {
      await onList(item, count);
      setDone(count);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="vt-station-card" p="md" data-station-card="item">
      <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
        <Text className="vt-station-card-title" size="lg" style={{ color: TIER_CSS[tierOf(item.total)] }}>
          {item.name}
        </Text>
        <Group gap={6} wrap="nowrap">
          {demo && (
            <Badge color="orange" variant="light">
              Demo
            </Badge>
          )}
          <Badge color="cyan" variant="outline">
            {bayLabel(item.category)}
          </Badge>
        </Group>
      </Group>
      <Stack gap="xs">
        <div className="vt-station-facts">
          <Text size="xs" c="dimmed">
            Owned
          </Text>
          <Text size="sm" fw={700}>
            {item.quantity}
          </Text>
          <Text size="xs" c="dimmed">
            Price each
          </Text>
          <Text size="sm" fw={700} c={caveat ? "orange.5" : undefined}>
            {caveat ? "~" : ""}
            {fmt(item.unit_price)}p
          </Text>
          <Text size="xs" c="dimmed">
            Total{count !== item.quantity ? ` for ${count}` : ""}
          </Text>
          <Text size="sm" fw={700} c="yellow.4" data-station-total>
            {caveat ? "~" : ""}
            {fmt(item.unit_price * count)}p
          </Text>
          <Text size="xs" c="dimmed">
            Sold per day
          </Text>
          <Text size="sm" fw={700}>
            {item.volume}
          </Text>
        </div>
        {caveat && (
          <Text size="xs" c="orange.4">
            {caveat}
          </Text>
        )}
        {error && (
          <Alert color="red" p="xs" title="Could not list this item" data-station-error>
            {error}
          </Alert>
        )}
        {done !== null && (
          <Alert color="teal" p="xs" data-station-listed>
            {item.name} x{done} added to stock at 0p cost.
          </Alert>
        )}
        <Group justify="space-between" align="flex-end" mt={4} wrap="nowrap">
          <NumberInput
            label="Quantity"
            size="xs"
            w={96}
            min={1}
            max={item.quantity}
            allowDecimal={false}
            clampBehavior="strict"
            value={qty}
            onChange={(v) => setQty(Number(v) || 1)}
            disabled={busy || item.in_stock || item.quantity <= 1}
          />
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" size="xs" onClick={onClose}>
              Close (Esc)
            </Button>
            {item.in_stock ? (
              <Badge color="teal" size="lg" variant="light" data-station-instock>
                Listed
              </Badge>
            ) : (
              <Button size="xs" color="yellow" loading={busy} onClick={list} data-station-list>
                List for sale
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Not connected
// ---------------------------------------------------------------------------

export function ConnectHelp({ error }: { error?: string }) {
  return (
    <Stack gap="xs">
      <Text size="sm">The warehouse shows what you own in Warframe, read from the file AlecaFrame saves while the game is running. Nothing is connected yet, so the shelves are empty.</Text>
      <Text size="sm">
        Open{" "}
        <Text span fw={700} c="yellow.4">
          Cargo &gt; Sell Finder
        </Text>{" "}
        and press{" "}
        <Text span fw={700} c="yellow.4">
          Connect AlecaFrame
        </Text>
        . Then come back here: the stock is read again each time you walk in.
      </Text>
      {error && (
        <Alert color="red" p="xs" title="Could not read your inventory">
          {error}
        </Alert>
      )}
    </Stack>
  );
}

export function ConnectCard({ error, onClose }: { error?: string; onClose: () => void }) {
  return (
    <Card className="vt-station-card" p="md" data-station-card="connect">
      <Text className="vt-station-card-title" size="lg" mb="xs">
        Warehouse offline
      </Text>
      <ConnectHelp error={error} />
      <Group justify="flex-end" mt="md">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sortable stock table (bay terminal and quick panel)
// ---------------------------------------------------------------------------

type SortKey = "name" | "category" | "quantity" | "unit_price" | "total" | "volume";
const COLUMNS: Array<{ key: SortKey; label: string; right?: boolean }> = [
  { key: "name", label: "Item" },
  { key: "category", label: "Type" },
  { key: "quantity", label: "Owned", right: true },
  { key: "unit_price", label: "Each", right: true },
  { key: "total", label: "Total", right: true },
  { key: "volume", label: "Sold/day", right: true },
];
const FILTERS = [{ value: "all", label: "All" }, ...BAYS.map((b) => ({ value: b.key as string, label: b.label }))];

export function StockTable({ sell, category, bulk, onList }: { sell: SellResult; category?: BayKey; bulk?: boolean; onList: ListFn }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "total", desc: true });
  const [filter, setFilter] = useState<string>(category ?? "all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  useEffect(() => setFilter(category ?? "all"), [category]);

  const items = sell.result.items;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter((i) => (filter === "all" || (BAYS.some((b) => b.key === i.category) ? i.category : "other") === filter) && (!q || i.name.toLowerCase().includes(q)));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
      return cmp * dir || b.total - a.total || a.name.localeCompare(b.name);
    });
  }, [items, filter, search, sort]);
  const top = useMemo(() => topUnlisted(items, 5), [items]);

  const listOne = async (item: SellCandidate): Promise<boolean> => {
    setBusy((b) => ({ ...b, [item.unique_name]: true }));
    setErrors(({ [item.unique_name]: _gone, ...rest }) => rest);
    try {
      await onList(item, item.quantity);
      return true;
    } catch (e) {
      setErrors((r) => ({ ...r, [item.unique_name]: errorText(e) }));
      return false;
    } finally {
      setBusy(({ [item.unique_name]: _gone, ...rest }) => rest);
    }
  };

  const listTop = async () => {
    setBulkBusy(true);
    setBulkNote(null);
    let ok = 0;
    // one at a time, so a refusal stops nothing else and each row shows its own result
    for (const item of top) if (await listOne(item)) ok++;
    setBulkNote(ok === top.length ? `Listed ${ok} item${ok === 1 ? "" : "s"}.` : `Listed ${ok} of ${top.length}. The rows that failed say why.`);
    setBulkBusy(false);
  };

  const flip = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" && key !== "category" }));

  return (
    <div className="vt-station-stock">
      <Group gap="xs" align="flex-end" wrap="wrap" mb={6}>
        <TextInput size="xs" placeholder="Search item" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={150} data-station-search />
        {!category && <SegmentedControl size="xs" data={FILTERS} value={filter} onChange={setFilter} />}
        {bulk && (
          <Tooltip label={top.length ? top.map((i) => `${i.name} (${fmt(i.total)}p)`).join(", ") : "Nothing left to list"} multiline w={300}>
            <Button size="xs" color="yellow" ml="auto" disabled={top.length === 0} loading={bulkBusy} onClick={listTop} data-station-list-top>
              List top {Math.min(5, top.length) || 5} by value ({fmt(top.reduce((s, i) => s + i.total, 0))}p)
            </Button>
          </Tooltip>
        )}
      </Group>
      {bulkNote && (
        <Text size="xs" c="teal.4" mb={4}>
          {bulkNote}
        </Text>
      )}
      <div className="vt-station-stock-scroll">
        <Table stickyHeader highlightOnHover verticalSpacing={3} fz="sm">
          <Table.Thead>
            <Table.Tr>
              {COLUMNS.map((c) => (
                <Table.Th key={c.key} ta={c.right ? "right" : undefined}>
                  <UnstyledButton className="vt-station-sort" onClick={() => flip(c.key)} data-station-sort={c.key}>
                    {c.label}
                    {sort.key === c.key ? (sort.desc ? " ▼" : " ▲") : ""}
                  </UnstyledButton>
                </Table.Th>
              ))}
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((i) => (
              <Table.Tr key={i.unique_name}>
                <Table.Td>
                  <span className="vt-station-dot" style={{ background: TIER_CSS[tierOf(i.total)] }} />
                  {i.name}
                  {errors[i.unique_name] && (
                    <Text size="xs" c="red.4">
                      {errors[i.unique_name]}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {bayLabel(i.category)}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">{i.quantity}</Table.Td>
                <Table.Td ta="right">
                  <Price item={i} />
                </Table.Td>
                <Table.Td ta="right">
                  <Text span c="yellow.4" fw={700} inherit>
                    {fmt(i.total)}p
                  </Text>
                </Table.Td>
                <Table.Td ta="right">{i.volume}</Table.Td>
                <Table.Td ta="right">
                  {i.in_stock ? (
                    <Badge color="teal" variant="light">
                      Listed
                    </Badge>
                  ) : (
                    <Button size="compact-xs" loading={!!busy[i.unique_name]} onClick={() => void listOne(i)} data-station-row-list>
                      List
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {rows.length === 0 && (
          <Text c="dimmed" ta="center" size="sm" mt="md">
            Nothing matches.{sell.result.unpriced > 0 ? ` ${sell.result.unpriced} owned items have no recent market data.` : ""}
          </Text>
        )}
      </div>
    </div>
  );
}

export function BayCard({ sell, category, onList, onClose }: { sell: SellResult; category: BayKey; onList: ListFn; onClose: () => void }) {
  const count = sell.result.items.filter((i) => i.category === category || (category === "other" && !BAYS.some((b) => b.key === i.category))).length;
  return (
    <Card className="vt-station-card vt-station-card-wide" p="md" data-station-card="bay">
      <Group justify="space-between" mb="xs">
        <Text className="vt-station-card-title" size="lg">
          {bayLabel(category)} bay
        </Text>
        <Text size="xs" c="dimmed">
          {count} item type{count === 1 ? "" : "s"}
        </Text>
      </Group>
      <StockTable sell={sell} category={category} onList={onList} />
      <Group justify="flex-end" mt="xs">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quick panel
// ---------------------------------------------------------------------------

export function QuickPanel({ sell, loading, onList, onRescan, onClose }: { sell: SellResult | null; loading: boolean; onList: ListFn; onRescan: () => void; onClose: () => void }) {
  const s = summarize(sell?.result ?? null);
  return (
    <div className="vt-station-panel" data-station-panel>
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Group gap="xs" wrap="nowrap">
          <Text className="vt-station-card-title" size="lg">
            Stock list
          </Text>
          {sell?.demo && (
            <Badge color="orange" variant="light" size="sm">
              Demo data
            </Badge>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Button variant="default" size="compact-xs" loading={loading} onClick={onRescan} data-station-rescan>
            Refresh inventory
          </Button>
          <CloseButton onClick={onClose} aria-label="Close stock list" />
        </Group>
      </Group>
      {!sell ? (
        <Text size="sm" c="dimmed">
          Reading the warehouse...
        </Text>
      ) : !s.connected ? (
        <ConnectHelp error={sell.error} />
      ) : (
        <>
          <Text size="xs" c="dimmed" mb={6}>
            <Text span c="yellow.4" fw={700} inherit>
              {fmt(s.sellable)}p
            </Text>{" "}
            sellable · {s.types} item types · {s.trades} trades left today · MR {s.mastery}
            {s.listedTypes > 0 ? ` · ${s.listedTypes} listed (${fmt(s.listedValue)}p)` : ""}. Listing adds the item to stock at 0p cost; nothing is listed until you click.
          </Text>
          <StockTable sell={sell} bulk onList={onList} />
        </>
      )}
      <Text size="xs" c="dimmed" mt={6}>
        <kbd>Tab</kbd> or <kbd>Esc</kbd> closes
      </Text>
    </div>
  );
}
