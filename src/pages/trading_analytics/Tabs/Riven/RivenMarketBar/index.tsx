import { Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import api from "@api/index";
import type { RivenMarketStatus } from "@api/riven";

export interface RivenMarketBarProps {
  /** Called when a scan finishes so the table can reload. */
  onScanComplete?: () => void;
}

/** Void Trader: controls for the local riven market scanner. */
export function RivenMarketBar({ onScanComplete }: RivenMarketBarProps) {
  const [status, setStatus] = useState<RivenMarketStatus | null>(null);
  const wasRunning = useRef(false);

  const refresh = async () => {
    try {
      const s = await api.riven.marketStatus();
      setStatus(s);
      if (wasRunning.current && !s.running) onScanComplete?.();
      wasRunning.current = s.running;
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  const pct = status && status.total > 0 ? (status.done / status.total) * 100 : 0;
  const last = status?.last_completed ? dayjs(status.last_completed).format("YYYY-MM-DD HH:mm") : "never";

  return (
    <Paper p="sm" mb="md">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text fw={700} c="orokin.4" tt="uppercase" style={{ letterSpacing: "0.12em" }}>
            Void Trader Riven Market
          </Text>
          <Text size="sm" c="dimmed">
            {status?.running
              ? `Scanning ${status.done}/${status.total}${status.current ? ` — ${status.current}` : ""}`
              : `Live buyout prices from warframe.market auctions. Last scan: ${last}`}
          </Text>
          {status?.last_error && (
            <Text size="sm" c="red.6">
              Last scan failed: {status.last_error}
            </Text>
          )}
        </Stack>
        {status?.running ? (
          <Button
            variant="outline"
            color="red"
            onClick={async () => {
              setStatus(await api.riven.marketStop());
            }}
          >
            Stop scan
          </Button>
        ) : (
          <Button
            onClick={async () => {
              wasRunning.current = true;
              setStatus(await api.riven.marketScan());
            }}
          >
            Scan riven market
          </Button>
        )}
      </Group>
      {status?.running && <Progress mt="sm" value={pct} color="corpus.5" animated striped />}
    </Paper>
  );
}
