import {
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { faLock } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useRef, useState } from "react";
import api from "@api/index";
import type {
  StrategyAdjustment,
  StrategyPresetInfo,
  StrategySetInput,
  StrategyStatus,
  TradingPreset,
} from "@api/live_scraper";

const POLL_MS = 10_000;

const PRESET_LABEL: Record<TradingPreset, string> = {
  scavenger: "Scavenger",
  flipper: "Flipper",
  high_roller: "High Roller",
  riven_hunter: "Riven Hunter",
  liquidate: "Liquidate",
};

const errorText = (e: any) =>
  e?.message || e?.cause || (typeof e === "string" ? e : JSON.stringify(e));
const fmt = (n: number) => n.toLocaleString();
const plat = (n: number) => (n < 0 ? "off" : `${fmt(n)}p`);

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/** Short "what this preset does" line built from its real values. */
const presetFacts = (p: StrategyPresetInfo) => {
  const v = p.values;
  const buy = v.buy_enabled
    ? `Buys up to ${v.wtb_avg_price_cap}p`
    : "No buying";
  return `${buy} · min profit ${v.wts_min_profit}p · undercut ${v.wts_undercut_step}p`;
};

type PresetCardProps = {
  info: StrategyPresetInfo;
  selected: boolean;
  inForce: boolean;
  busy: boolean;
  onSelect: (id: TradingPreset) => void;
};

const PresetCard = ({
  info,
  selected,
  inForce,
  busy,
  onSelect,
}: PresetCardProps) => {
  const locked = !info.allowed;
  const card = (
    <UnstyledButton
      onClick={() => !locked && !busy && !selected && onSelect(info.id)}
      aria-pressed={selected}
      aria-disabled={locked}
      style={{
        height: "100%",
        width: "100%",
        cursor: locked ? "not-allowed" : selected ? "default" : "pointer",
      }}
    >
      <Paper
        p="sm"
        h="100%"
        withBorder
        style={{
          opacity: locked ? 0.45 : 1,
          borderColor: selected
            ? "var(--mantine-color-orokin-4)"
            : inForce
              ? "var(--mantine-color-corpus-5)"
              : undefined,
          boxShadow: selected
            ? "0 0 0 1px var(--mantine-color-orokin-4)"
            : undefined,
        }}
      >
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap" gap={6}>
            <Text fw={700} c={selected ? "orokin.4" : undefined}>
              {info.name}
            </Text>
            {locked ? (
              <Badge
                color="gray"
                variant="light"
                leftSection={<FontAwesomeIcon icon={faLock} size="xs" />}
              >
                {fmt(info.min_net_worth)}p
              </Badge>
            ) : selected ? (
              <Badge color="orokin" variant="light">
                Selected
              </Badge>
            ) : inForce ? (
              <Badge color="corpus" variant="light">
                In force
              </Badge>
            ) : null}
          </Group>
          <Text size="sm" c="dimmed" lh={1.3}>
            {info.description}
          </Text>
          <Text size="xs" c="corpus.4">
            {presetFacts(info)}
          </Text>
        </Stack>
      </Paper>
    </UnstyledButton>
  );
  return locked ? (
    <Tooltip
      label={`Needs a net worth of ${fmt(info.min_net_worth)}p. Turn off strict tiers to use it anyway.`}
      multiline
      w={240}
    >
      {card}
    </Tooltip>
  ) : (
    card
  );
};

const FeedRow = ({ entry }: { entry: StrategyAdjustment }) => (
  <Group gap="xs" wrap="nowrap" align="flex-start">
    <Text size="xs" c="dimmed" ff="monospace" miw={44} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
      {timeOf(entry.time)}
    </Text>
    <Text size="sm" lh={1.35}>
      {entry.reason}
    </Text>
  </Group>
);

/** Void Trader: trading preset picker + smart trader status, shown above the live trading tabs. */
export const StrategyPanel = () => {
  const [status, setStatus] = useState<StrategyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const [platDraft, setPlatDraft] = useState<number | "">("");
  const [open, setOpen] = useLocalStorage<boolean>({
    key: "live_scraper.strategy_open_v2",
    defaultValue: false,
  });

  const load = useCallback(async () => {
    try {
      const next = await api.live_scraper.strategyStatus();
      if (!alive.current) return;
      setStatus(next);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [load]);

  const update = async (input: StrategySetInput) => {
    setBusy(true);
    try {
      const next = await api.live_scraper.strategySet(input);
      if (alive.current) setStatus(next);
    } catch (e) {
      notifications.show({
        title: "Strategy not changed",
        message: errorText(e),
        color: "red",
      });
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  if (!status) {
    return error ? (
      <Alert color="red" title="Strategy unavailable" mb="md">
        {error}
      </Alert>
    ) : null;
  }

  const switched = status.effective_preset !== status.preset;
  const eff = status.effective;

  return (
    <Paper p="md" mt="md" mb="md" withBorder>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Text size="xs" tt="uppercase" c="dimmed">
            Strategy
          </Text>
          <Group gap="xs" align="baseline">
            <Text fz="xl" fw={700} c="orokin.4">
              {fmt(status.net_worth)}p
            </Text>
            <Text c="dimmed">net worth</Text>
            <Badge color="corpus" variant="light">
              {PRESET_LABEL[status.tier]} tier
            </Badge>
            <Badge color={switched ? "corpus" : "orokin"} variant="outline">
              Trading as {PRESET_LABEL[status.effective_preset]}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {fmt(status.platinum)}p plat
            {status.balance_is_live ? "" : status.platinum > 0 ? " (typed in)" : " (not set)"} +{" "}
            {fmt(status.stock_value)}p paid for unsold stock
            {status.trades_remaining != null
              ? ` · ${status.trades_remaining} trades left today`
              : ""}
          </Text>
          {!status.balance_is_live && (
            <Group gap={6} align="flex-end">
              <NumberInput
                size="xs"
                w={150}
                min={0}
                allowDecimal={false}
                label="Your plat right now"
                placeholder="e.g. 76"
                value={platDraft}
                onChange={(v) => setPlatDraft(v === "" ? "" : Number(v))}
              />
              <Button size="xs" disabled={busy || platDraft === ""} onClick={() => update({ manual_platinum: Number(platDraft) })}>
                Set
              </Button>
              <Text size="xs" c="dimmed" maw={320}>
                No live inventory data, so tiers and buy limits use this number. Update it as you earn, or connect AlecaFrame in Cargo.
              </Text>
            </Group>
          )}
        </Stack>
        <Stack gap={6} align="flex-end">
          <Tooltip
            label="Adjusts the preset from your plat, trades left today, stuck stock and each item's price trend. It never changes your saved settings."
            multiline
            w={280}
          >
            <Box>
              <Switch
                label="Smart trader"
                color="corpus"
                checked={status.smart_enabled}
                disabled={busy}
                onChange={(e) =>
                  update({ smart_enabled: e.currentTarget.checked })
                }
              />
            </Box>
          </Tooltip>
          <Tooltip
            label="When on, presets above your net worth tier cannot be selected."
            multiline
            w={280}
          >
            <Box>
              <Switch
                label="Strict tiers"
                size="xs"
                color="orokin"
                checked={status.strict_tiers}
                disabled={busy}
                onChange={(e) =>
                  update({ strict_tiers: e.currentTarget.checked })
                }
              />
            </Box>
          </Tooltip>
          <Button
            variant="subtle"
            size="compact-xs"
            color="gray"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? "Hide presets and activity" : "Show presets and activity"}
          </Button>
        </Stack>
      </Group>

      <Collapse expanded={open}>
        <SimpleGrid
          cols={{ base: 1, sm: 2, md: 3, xl: 5 }}
          spacing="sm"
          mt="sm"
        >
          {status.presets.map((p) => (
            <PresetCard
              key={p.id}
              info={p}
              selected={p.id === status.preset}
              inForce={switched && p.id === status.effective_preset}
              busy={busy}
              onSelect={(id) => update({ preset: id })}
            />
          ))}
        </SimpleGrid>

        {switched && (
          <Alert
            color="corpus"
            variant="light"
            mt="sm"
            title={`Trading as ${PRESET_LABEL[status.effective_preset]} for now`}
          >
            {status.active_adjustments.find((a) => a.field === "preset")
              ?.reason ??
              `The smart trader switched from ${PRESET_LABEL[status.preset]}. Your selection is kept.`}
          </Alert>
        )}

        <Group gap="lg" mt="sm">
          <Text size="sm">
            <Text span c="dimmed">
              Buying:{" "}
            </Text>
            {eff.buy_enabled
              ? `up to ${plat(eff.max_buy_price)} each, ${plat(eff.max_total_buy)} in open orders, ROI ${eff.min_roi_percentage < 0 ? "off" : `${eff.min_roi_percentage}%+`}`
              : "off"}
          </Text>
          <Text size="sm">
            <Text span c="dimmed">
              Selling:{" "}
            </Text>
            min profit {plat(eff.sell_min_profit)}, undercut{" "}
            {plat(eff.sell_undercut)}, price drops after{" "}
            {eff.stale_after_days < 0
              ? "never"
              : `${eff.stale_after_days} days`}
          </Text>
          <Text size="sm">
            <Text span c="dimmed">
              Rivens:{" "}
            </Text>
            min profit {plat(eff.riven_min_profit)}, stat matching{" "}
            {eff.riven_auto_match_stats ? "on" : "off"}
          </Text>
        </Group>

        <Text size="xs" tt="uppercase" c="dimmed" mt="md" mb={4}>
          Smart trader activity
        </Text>
        <ScrollArea h={120} type="auto" offsetScrollbars>
          {status.recent_adjustments.length === 0 ? (
            <Text size="sm" c="dimmed">
              {status.smart_enabled
                ? "No adjustments yet. The preset values are in use as they are."
                : "Smart trader is off. The preset values are in use as they are."}
            </Text>
          ) : (
            <Stack gap={4}>
              {status.recent_adjustments.map((entry, i) => (
                <FeedRow
                  key={`${entry.time}-${entry.field}-${i}`}
                  entry={entry}
                />
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Collapse>
      {error && (
        <Text size="xs" c="red.5" mt={4}>
          Could not refresh: {error}
        </Text>
      )}
    </Paper>
  );
};
