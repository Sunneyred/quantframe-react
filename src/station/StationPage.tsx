import { TauriTypes, UserStatus } from "$types";
import api, { SendTauriDataEvent, SendTauriEvent, WFMThumbnail } from "@api/index";
import { routeLoaders } from "@components/Layouts/routeLoaders";
import { SettingsForm } from "@components/Forms/Settings";
import { useAppContext } from "@contexts/app.context";
import { useAuthContext } from "@contexts/auth.context";
import { useLiveScraperContext } from "@contexts/liveScraper.context";
import { useTranslateCommon, useTranslateComponent, useTranslateEnums } from "@hooks/useTranslate.hook";
import { Avatar, Box, Button, Group, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import i18next from "i18next";
import { Suspense, lazy, useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import StationCore, { type StationHost } from "./StationCore";
import type { PanelId } from "./ui/panels";

/**
 * The station as it runs inside the app: this wrapper is the only part that
 * touches the app's contexts, API client and pages. It hands the station the
 * live trader state and the real screens for its terminals. (The standalone
 * dev page mounts StationCore without it.)
 */

// The same lazy chunks the classic routes use.
const PHome = lazy(routeLoaders.home);
const PLiveScraper = lazy(routeLoaders.liveScraper);
const PWarframeMarket = lazy(routeLoaders.warframeMarket);
const PChat = lazy(routeLoaders.chat);
const PTradingAnalytics = lazy(routeLoaders.tradingAnalytics);
const PWfInventory = lazy(routeLoaders.wfInventory);
const PTradeMessages = lazy(routeLoaders.tradeMessages);
const PAbout = lazy(routeLoaders.about);
const PDebug = lazy(routeLoaders.debug);
const StrategyPanel = lazy(() => import("@pages/live_scraper/StrategyPanel").then((m) => ({ default: m.StrategyPanel })));

const stripTags = (text: string) => text.replace(/<[^>]+>/g, "");

/** Engineering terminal: the settings form, saved exactly as the user menu saves it. */
function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const { settings, setLang } = useAppContext();
  if (!settings) return <Text p="xl">Settings are still loading.</Text>;
  return (
    <Box p="sm">
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

/** Captain's console: the user menu's functions (status, log out) plus the way out to the classic view. */
function CaptainConsole({ onClassic }: { onClassic: () => void }) {
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
    <Stack align="center" justify="center" h="100%" gap="md" p="xl" data-station-captain>
      <Avatar src={user?.wfm_avatar ? WFMThumbnail(user.wfm_avatar) : "/default_avatar.png"} alt={user?.wfm_username} radius="xl" size={96} />
      <Text className="vt-station-card-title" fz={26}>
        {user?.wfm_username || "Unknown"}
      </Text>
      {connected ? (
        <Stack gap={6} align="center">
          <Text size="xs" tt="uppercase" c="dimmed">
            Status on warframe.market
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
      <Group gap="sm" mt="md">
        <Button variant="outline" color="yellow" onClick={onClassic}>
          Leave to the classic view
        </Button>
        <Button color="red" variant="light" disabled={!authenticated} loading={busy} onClick={logout}>
          {t("items.logout")}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        The Station button at the top of the side bar brings you back here.
      </Text>
    </Stack>
  );
}

export default function StationPage() {
  const { is_running, message } = useLiveScraperContext();
  const { settings } = useAppContext();
  const { user } = useAuthContext();
  const navigate = useNavigate();

  const autoDelete = Boolean(settings?.live_scraper?.general?.auto_delete);

  // Same calls as the classic start/stop button (components/Forms/LiveScraperControl).
  const toggleTrader = useCallback(() => {
    const t = (key: string) => useTranslateComponent(`live_scraper_control.${key}`);
    const toggle = () =>
      api.live_scraper.toggle().catch(() => notifications.show({ title: t("errors.login.title"), message: t("errors.login.message"), color: "red.7" }));
    if (!is_running && autoDelete) {
      modals.openConfirmModal({
        title: t("prompts.start.title"),
        children: <Text size="sm">{t("prompts.start.message")}</Text>,
        labels: { confirm: t("prompts.start.confirm"), cancel: t("prompts.start.cancel") },
        onConfirm: () => void toggle(),
      });
    } else void toggle();
  }, [is_running, autoDelete]);

  const statusLine = useMemo(() => {
    if (!is_running || !message || !message.i18nKey) return "";
    return stripTags(i18next.t(`components.live_scraper_control.${message.i18nKey}`, { ...message.values }) as string);
  }, [is_running, message]);

  const classic = useCallback((path: string) => navigate(path || "/"), [navigate]);

  const renderPanel = useCallback(
    (id: PanelId, close: () => void): ReactNode => {
      switch (id) {
        case "overview":
          return <PHome />;
        case "live":
          return <PLiveScraper />;
        case "market":
          return <PWarframeMarket />;
        case "comms":
          return <PChat />;
        case "ledger":
          return <PTradingAnalytics />;
        case "scanner":
          return <PWfInventory />;
        case "tradechat":
          return <PTradeMessages />;
        case "about":
          return <PAbout />;
        case "debug":
          return <PDebug />;
        case "engineering":
          return <SettingsPanel onSaved={close} />;
        case "captain":
          return <CaptainConsole onClassic={() => classic("/")} />;
      }
    },
    [classic],
  );

  const renderStrategy = useCallback(
    () => (
      <Suspense fallback={<Text c="dimmed">Fetching the strategy...</Text>}>
        <StrategyPanel />
      </Suspense>
    ),
    [],
  );

  const host = useMemo<StationHost>(
    () => ({
      trader: { running: is_running, message: statusLine },
      startAsks: autoDelete,
      toggleTrader,
      renderPanel,
      renderStrategy,
      classic,
      unread: user?.unread_messages || 0,
    }),
    [is_running, statusLine, autoDelete, toggleTrader, renderPanel, renderStrategy, classic, user?.unread_messages],
  );

  return <StationCore host={host} />;
}
