import { Alert, Badge, Box, Button, Group, NumberInput, Paper, ScrollArea, SegmentedControl, Stack, Table, Text, TextInput, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useMemo, useState } from "react";
import api, { SendTauriEvent } from "@api/index";
import { TauriTypes } from "$types";
import type { SellCandidate, SellFinderResult } from "@api/wf_inventory";
import { useAppContext } from "@contexts/app.context";
import { useHasAlert } from "@hooks/useHasAlert.hook";
import { PlatGoalBar } from "@components/Shared/PlatGoalBar";

export type SellFinderPanelProps = { isActive?: boolean };

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "prime", label: "Primes" },
  { value: "set", label: "Sets" },
  { value: "mod", label: "Mods" },
  { value: "arcane", label: "Arcanes" },
  { value: "relic", label: "Relics" },
  { value: "other", label: "Other" },
];

const errorText = (e: any) => e?.message || e?.cause || (typeof e === "string" ? e : JSON.stringify(e));

/** Void Trader: ranks everything you own that is worth listing. */
export const SellFinderPanel = ({ isActive }: SellFinderPanelProps) => {
  const { settings } = useAppContext();
  // the page moves down 30px when the alert ticker is showing
  const hasAlert = useHasAlert();
  const [data, setData] = useState<SellFinderResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minPrice, setMinPrice] = useState<number>(5);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const source = settings?.wf_inventory?.source as any;
  const hasSource = !!source && source !== "None";

  const load = async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      if (refresh) await api.wf_inventory.refresh();
      setData(await api.wf_inventory.sellFinder(minPrice));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const connect = async () => {
    if (!settings) return;
    setLoading(true);
    setError(null);
    try {
      await api.app.updateSettings({ ...settings, wf_inventory: { ...settings.wf_inventory, source: { Alecaframe: { path: "" } } } } as any);
      // the backend does not announce a settings change: re-read them, or this page keeps thinking
      // there is no source and the settings form would later save the old "None" back
      SendTauriEvent(TauriTypes.Events.RefreshSettings);
      await api.wf_inventory.refresh();
      setData(await api.wf_inventory.sellFinder(minPrice));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isActive) load(false);
  }, [isActive, minPrice]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items || []).filter((i) => (category === "all" || i.category === category) && (!q || i.name.toLowerCase().includes(q)));
  }, [data, category, search]);

  const addToStock = async (item: SellCandidate) => {
    setAdding(item.unique_name);
    try {
      await api.stock_item.create({ raw: item.wfm_url, quantity: item.quantity, bought: 0, sub_type: item.sub_type });
      notifications.show({ color: "green", message: `${item.name} x${item.quantity} added to stock at 0p cost` });
      setData(await api.wf_inventory.sellFinder(minPrice));
    } catch (e) {
      notifications.show({ color: "red", message: `Could not add ${item.name}: ${errorText(e)}` });
    } finally {
      setAdding(null);
    }
  };

  return (
    <Box p="md">
      <PlatGoalBar />
      <Paper p="sm" mb="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={700} c="orokin.4" tt="uppercase" style={{ letterSpacing: "0.12em" }}>
              Sell Finder
            </Text>
            {data?.connected ? (
              <Text size="sm" c="dimmed">
                MR {data.mastery_rank} · {data.trades_remaining} trades left today · {data.owned_tradable} tradable item types owned ·{" "}
                <Text span c="orokin.4" fw={700}>
                  about {data.total_value.toLocaleString()}p
                </Text>{" "}
                sellable at current prices
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                Reads your inventory from the file AlecaFrame saves while Warframe is running.
              </Text>
            )}
          </Stack>
          <Group>
            {!hasSource || !data?.connected ? (
              <Button onClick={connect} loading={loading}>
                Connect AlecaFrame
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => load(true)} loading={loading} disabled={!hasSource}>
              Refresh inventory
            </Button>
          </Group>
        </Group>
      </Paper>

      {error && (
        <Alert color="red" mb="md" title="Could not read your inventory">
          {error}
        </Alert>
      )}
      {hasSource && data && !data.connected && !error && (
        <Alert color="yellow" mb="md" title="No inventory data yet">
          Open Warframe with AlecaFrame running and log in, then press Refresh inventory.
        </Alert>
      )}

      {data?.connected && (
        <>
          <Group mb="sm" align="flex-end">
            <TextInput label="Search" placeholder="Item name" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
            <NumberInput label="Hide under (plat)" min={0} w={150} value={minPrice} onChange={(v) => setMinPrice(Number(v) || 0)} />
            <SegmentedControl data={CATEGORIES} value={category} onChange={setCategory} />
          </Group>
          <ScrollArea h={`calc(var(--vt-vh, 100vh) - ${hasAlert ? 430 : 400}px)`}>
            <Table stickyHeader highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Item</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th ta="right">Owned</Table.Th>
                  <Table.Th ta="right">Each</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                  <Table.Th ta="right">Sold per day</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((i) => (
                  <Table.Tr key={i.unique_name}>
                    <Table.Td>{i.name}</Table.Td>
                    <Table.Td>
                      <Badge variant="outline" color="corpus">
                        {i.category}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">{i.quantity}</Table.Td>
                    <Table.Td ta="right">
                      {i.basis === "exact" ? (
                        `${i.unit_price}p`
                      ) : (
                        <Tooltip
                          label={
                            i.basis === "max_rank"
                              ? "This is the max-rank price. Your unranked copy sells for less, so it is left out of the total above."
                              : "Estimate: the max-rank price divided by the copies needed to build one."
                          }
                        >
                          <Text span c="orange.5">
                            ~{i.unit_price}p
                          </Text>
                        </Tooltip>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text span c="orokin.4" fw={700}>
                        {i.total.toLocaleString()}p
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">{i.volume}</Table.Td>
                    <Table.Td ta="right">
                      {i.in_stock ? (
                        <Badge color="teal">In stock</Badge>
                      ) : (
                        <Button size="compact-sm" loading={adding === i.unique_name} onClick={() => addToStock(i)}>
                          Add to stock
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {rows.length === 0 && (
              <Text c="dimmed" ta="center" mt="lg">
                Nothing matches. {data.unpriced > 0 ? `${data.unpriced} owned items have no recent market data.` : ""}
              </Text>
            )}
          </ScrollArea>
        </>
      )}
    </Box>
  );
};
