import { Text, Group, Title } from "@mantine/core";
import { useAppContext } from "@contexts/app.context";
import classes from "./Logo.module.css";

export function Logo({ color }: { color: string }) {
  const { app_info } = useAppContext();
  return (
    <Group gap="xs">
      <img src="/void-trader-logo.png" alt="Void Trader" className={classes.logo} />
      <Title order={4} className={classes.wordmark} style={{ color: color }}>
        {(app_info?.name || "Void Trader").toUpperCase()}
      </Title>
      <Text size={"sm"} fw={500} className={classes.version}>
        v{app_info?.version}
      </Text>
      {app_info?.is_pre_release && (
        <Text size={"md"} fw={500} data-color="gold" data-color-mode="shine">
          [PRE RELEASE]
        </Text>
      )}
      {app_info?.is_dev && (
        <Text size={"md"} fw={500} c="orange.7">
          [DEV]
        </Text>
      )}
      {app_info?.use_temp_db && (
        <Text size={"md"} fw={500} data-color="gold" data-color-mode="shine">
          [TEMP DB]
        </Text>
      )}
    </Group>
  );
}
