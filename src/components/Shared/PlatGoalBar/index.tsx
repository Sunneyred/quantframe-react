import { Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { useEffect, useState } from "react";
import api from "@api/index";
import type { PlatGoal } from "@api/wf_inventory";
import classes from "./PlatGoalBar.module.css";

/** Void Trader: current plat against the next goal, plus today's target. */
export function PlatGoalBar() {
  const [goal, setGoal] = useState<PlatGoal | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.wf_inventory
        .platGoal()
        .then((g) => alive && setGoal(g))
        .catch((e) => console.error(e));
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!goal) return null;
  const pct = Math.round(goal.progress * 100);
  const todayPct = Math.min(100, Math.round((Math.max(0, goal.profit_today) / Math.max(1, goal.daily_target)) * 100));
  const fmt = (n: number) => n.toLocaleString();

  return (
    <Paper p="sm" mb="md" className={classes.root}>
      <Group justify="space-between" align="flex-end" mb={6}>
        <Stack gap={0}>
          <Text size="xs" tt="uppercase" c="dimmed" className={classes.label}>
            Vault
          </Text>
          <Group gap={6} align="baseline">
            <Text className={classes.plat}>{fmt(goal.platinum)}p</Text>
            <Text c="dimmed">/ {fmt(goal.goal)}p goal</Text>
            {!goal.balance_is_live && (
              <Tooltip label="No inventory data yet, so this is your tracked buy and sell total, not your real balance. Connect AlecaFrame in Cargo.">
                <Text size="xs" c="orange.5">
                  (estimated)
                </Text>
              </Tooltip>
            )}
          </Group>
        </Stack>
        <Stack gap={0} align="flex-end">
          <Text size="xs" tt="uppercase" c="dimmed" className={classes.label}>
            Today
          </Text>
          <Text>
            <Text span c={goal.profit_today >= goal.daily_target ? "teal.4" : "corpus.4"} fw={700}>
              {fmt(goal.profit_today)}p
            </Text>{" "}
            / {fmt(goal.daily_target)}p target
          </Text>
        </Stack>
      </Group>
      <div className={classes.track} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={classes.fill} style={{ width: `${pct}%` }} />
        <div className={classes.today} style={{ width: `${todayPct}%` }} />
      </div>
      <Group justify="space-between" mt={4}>
        <Text size="xs" c="dimmed">
          {fmt(goal.floor)}p
        </Text>
        <Text size="xs" c="dimmed">
          {fmt(Math.max(0, goal.goal - goal.platinum))}p to go
          {goal.avg_daily_profit > 0 ? `, about ${Math.ceil((goal.goal - goal.platinum) / goal.avg_daily_profit)} days at your pace` : ""}
        </Text>
        <Text size="xs" c="dimmed">
          {fmt(goal.goal)}p
        </Text>
      </Group>
    </Paper>
  );
}
