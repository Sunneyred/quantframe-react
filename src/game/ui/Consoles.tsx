import { TauriTypes, UserStatus } from "$types";
import api, { SendTauriDataEvent, SendTauriEvent, WFMThumbnail } from "@api/index";
import { SettingsForm } from "@components/Forms/Settings";
import { useAppContext } from "@contexts/app.context";
import { useAuthContext } from "@contexts/auth.context";
import { useTranslateCommon, useTranslateComponent, useTranslateEnums } from "@hooks/useTranslate.hook";
import { Avatar, Box, Button, Group, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useState } from "react";

/**
 * The two Service Deck terminals that are not a classic route: the account console (the classic
 * user menu's functions) and the settings console (the classic settings dialog's form). Same
 * components, same commands, same events as the user menu (components/Layouts/Shared/UserMenu).
 */

/** Engineering: the settings form, saved exactly as the user menu saves it. */
export function SettingsConsole({ onSaved }: { onSaved: () => void }) {
  const { settings, setLang } = useAppContext();
  if (!settings) return <Text p="xl">Settings are still loading.</Text>;
  return (
    <Box p="sm" data-vtg-settings>
      <SettingsForm
        value={settings}
        onSubmit={async (s) => {
          try {
            if (s.lang != settings.lang && setLang) setLang(s.lang);
            await api.app.updateSettings(s);
            notifications.show({
              title: useTranslateCommon("notifications.update_settings.success.title"),
              message: useTranslateCommon("notifications.update_settings.success.message"),
              color: "green.7",
            });
            SendTauriEvent(TauriTypes.Events.RefreshSettings);
            onSaved();
          } catch (e) {
            console.error(e);
            notifications.show({
              title: useTranslateCommon("notifications.update_settings.error.title"),
              message: useTranslateCommon("notifications.update_settings.error.message", e as Record<string, unknown>),
              color: "red.7",
            });
          }
        }}
      />
    </Box>
  );
}

/** Captain's Console: market status (online / in game / invisible), connection state, log out. */
export function AccountConsole() {
  const { user } = useAuthContext();
  const { app_error } = useAppContext();
  const [busy, setBusy] = useState(false);
  const t = (key: string) => useTranslateComponent(`user_menu.${key}`);
  const connected = !!user && !user.anonymous && !user.qf_banned && !user.wfm_banned && !(app_error && app_error.hasOperation("Main:Disconnected"));
  const authenticated = !!user && !user.anonymous && !user.qf_banned && !user.wfm_banned && !!user.verification;

  const logout = () => {
    if (!authenticated) return;
    modals.openConfirmModal({
      title: t("prompts.logout.title"),
      children: <Text size="sm">{t("prompts.logout.message")}</Text>,
      labels: { confirm: t("prompts.logout.confirm"), cancel: t("prompts.logout.cancel") },
      onConfirm: async () => {
        setBusy(true);
        try {
          const u = await api.auth.logout();
          notifications.show({ title: t("success.logout.title"), message: t("success.logout.message"), color: "green.7" });
          SendTauriDataEvent(TauriTypes.Events.UpdateUser, TauriTypes.EventOperations.SET, u);
        } catch {
          notifications.show({ title: t("errors.logout.title"), message: t("errors.logout.message"), color: "red.7" });
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <Stack align="center" justify="center" h="100%" gap="md" p="xl" data-vtg-account>
      <Avatar src={user?.wfm_avatar ? WFMThumbnail(user.wfm_avatar) : "/default_avatar.png"} alt={user?.wfm_username} radius="xl" size={96} />
      <Text fz={26} fw={700}>
        {user?.wfm_username || "Unknown"}
      </Text>
      {(user?.unread_messages || 0) > 0 && (
        <Text size="sm" c="dimmed">
          {user?.unread_messages} unread at the Courier Inbox
        </Text>
      )}
      {connected ? (
        <Stack gap={6} align="center">
          <Text size="xs" tt="uppercase" c="dimmed">
            Market status
          </Text>
          <Group gap="xs">
            {Object.values(UserStatus).map((status) => (
              <Button key={status} variant={user?.wfm_status == status ? "filled" : "default"} data-color-mode="text" data-user-status={status} disabled={user?.wfm_status == status} onClick={() => api.user.set_status(status)}>
                {useTranslateEnums(`user_status.${status}`)}
              </Button>
            ))}
          </Group>
        </Stack>
      ) : (
        <Text c="red.7" fw={700}>
          {t("errors.connection_websocket_error")}
        </Text>
      )}
      <Button mt="md" color="red" variant="light" disabled={!authenticated} loading={busy} onClick={logout} data-vtg-logout>
        {t("items.logout")}
      </Button>
    </Stack>
  );
}
