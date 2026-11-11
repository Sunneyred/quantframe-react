import { Badge, Button, Card, Group, Progress, Stack, Text } from "@mantine/core";
import { useState, type ReactNode } from "react";
import { copyText } from "../data/bridge";
import { inviteCommand, whisperCommand, type Buyer, type GoalSnapshot } from "../engine/logic";

const fmt = (n: number) => Math.round(n).toLocaleString();

function CopyCommand({ label, command }: { label: string; command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    const ok = await copyText(command);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1600);
  };
  return (
    <Stack gap={2}>
      <Button variant="filled" size="xs" onClick={copy} data-station-copy={label}>
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      </Button>
      <Text className="vt-station-command">{command}</Text>
    </Stack>
  );
}

/** `children` is the "record the sale" section, when there is stock to sell from. */
export function CustomerCard({ buyer, onDone, children }: { buyer: Buyer; onDone: () => void; children?: ReactNode }) {
  const cmdName = buyer.commandName;
  return (
    <Card className="vt-station-card" p="md" data-station-card="customer">
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text className="vt-station-card-title" size="lg" truncate>
          {buyer.name}
        </Text>
        <Badge color={buyer.source === "debug" ? "gray" : "cyan"} variant="light">
          {buyer.source === "debug" ? "Debug buyer" : buyer.source === "whisper" ? "In-game whisper" : "warframe.market chat"}
        </Badge>
      </Group>
      <Stack gap="xs">
        {buyer.message ? (
          <Text className="vt-station-quote" size="sm">
            {buyer.message}
          </Text>
        ) : (
          <Text size="sm" c="dimmed">
            No message text came with this event.
          </Text>
        )}
        <Group gap="md">
          <Text size="xs" c="dimmed">
            Received {new Date(buyer.receivedAt).toLocaleTimeString()}
          </Text>
          {buyer.pings > 1 && (
            <Text size="xs" c="dimmed">
              {buyer.pings} messages
            </Text>
          )}
          {buyer.reputation !== undefined && (
            <Text size="xs" c="dimmed">
              Reputation {buyer.reputation}
            </Text>
          )}
          {buyer.status && (
            <Text size="xs" c="dimmed">
              Status {buyer.status}
            </Text>
          )}
        </Group>
        {cmdName ? (
          <>
            <CopyCommand label="Copy whisper" command={whisperCommand(cmdName)} />
            <CopyCommand label="Copy invite" command={inviteCommand(cmdName)} />
          </>
        ) : (
          <Text size="sm" c="orange.4">
            The event did not include this player's in-game name, so there is no command to copy. Open Chat to reply.
          </Text>
        )}
        {children}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" size="xs" onClick={onDone} data-station-done>
            Done, send them off (Esc)
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export function TankCard({ goal, demo, onClose }: { goal: GoalSnapshot | null; demo: boolean; onClose: () => void }) {
  if (!goal) {
    return (
      <Card className="vt-station-card" p="md">
        <Text>Vault data is still loading.</Text>
      </Card>
    );
  }
  const toGo = Math.max(0, goal.goal - goal.platinum);
  const pace = goal.avg_daily_profit && goal.avg_daily_profit > 0 ? Math.ceil(toGo / goal.avg_daily_profit) : null;
  const todayPct = goal.daily_target > 0 ? Math.min(100, Math.max(0, (goal.profit_today / goal.daily_target) * 100)) : 0;
  return (
    <Card className="vt-station-card" p="md" data-station-card="tank">
      <Group justify="space-between" mb="xs">
        <Text className="vt-station-card-title" size="lg">
          The Vault
        </Text>
        {demo ? (
          <Badge color="orange" variant="light">
            Demo data
          </Badge>
        ) : !goal.balance_is_live ? (
          <Badge color="orange" variant="light">
            Estimated
          </Badge>
        ) : (
          <Badge color="teal" variant="light">
            Live balance
          </Badge>
        )}
      </Group>
      <Stack gap="xs">
        <Group gap={6} align="baseline">
          <Text className="vt-station-card-title" fz={28}>
            {fmt(goal.platinum)}p
          </Text>
          <Text c="dimmed">/ {fmt(goal.goal)}p goal</Text>
        </Group>
        <Progress value={Math.round(goal.progress * 100)} color="yellow" size="lg" />
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            from {fmt(goal.floor)}p
          </Text>
          <Text size="xs" c="dimmed">
            {Math.round(goal.progress * 100)}% full, {fmt(toGo)}p to go
            {pace ? `, about ${pace} day${pace === 1 ? "" : "s"} at your pace` : ""}
          </Text>
        </Group>
        <Text size="sm" mt={4}>
          Today{" "}
          <Text span fw={700} c={goal.profit_today >= goal.daily_target && goal.daily_target > 0 ? "teal.4" : "cyan.4"}>
            {fmt(goal.profit_today)}p
          </Text>{" "}
          / {fmt(goal.daily_target)}p target
        </Text>
        <Progress value={todayPct} color="cyan" size="sm" />
        {demo && (
          <Text size="xs" c="dimmed">
            The backend did not answer, so these are placeholder numbers.
          </Text>
        )}
        {!demo && !goal.balance_is_live && (
          <Text size="xs" c="dimmed">
            No inventory data yet: this is your tracked buy and sell total, not your real balance.
          </Text>
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="default" size="xs" onClick={onClose}>
            Close (Esc)
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export function CounterCard({ onClose }: { onClose: () => void }) {
  return (
    <Card className="vt-station-card" p="md" data-station-card="counter">
      <Text className="vt-station-card-title" size="lg" mb="xs">
        Trade Desk
      </Text>
      <Text size="sm">Nobody is waiting. A customer walks in when a buyer messages you on warframe.market.</Text>
      <Group justify="flex-end" mt="md">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}
