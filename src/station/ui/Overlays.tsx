import { Badge, Button, Card, CloseButton, Group, Stack, Switch, Text, TextInput } from "@mantine/core";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RoomId } from "../engine/constants";
import type { TraderState } from "../engine/lowerRooms";
import { PANELS, PLACES, ROOM_ORDER, roomName, type PanelId, type Place } from "./panels";

// ---------------------------------------------------------------------------
// Holo panel: a real app page shown inside the station
// ---------------------------------------------------------------------------

class PanelBoundary extends Component<{ children: ReactNode; name: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error) {
      return (
        <Stack align="center" justify="center" h="100%" gap="xs" p="xl">
          <Text className="vt-station-card-title" size="lg">
            {this.props.name} could not be shown here
          </Text>
          <Text size="sm" c="orange.4" ta="center">
            {this.state.error}
          </Text>
          <Text size="sm" c="dimmed">
            The station keeps running. The same screen is available in the classic view.
          </Text>
        </Stack>
      );
    }
    return this.props.children;
  }
}

export function HoloPanel({ id, children, onClose, onClassic }: { id: PanelId; children: ReactNode; onClose: () => void; onClassic?: () => void }) {
  const info = PANELS[id];
  return (
    <div className="vt-station-holo" data-station-panel={id}>
      <div className="vt-station-holo-bar">
        <span className="vt-station-holo-title">{info.title}</span>
        <span className="vt-station-holo-sub">{info.what}</span>
        <span className="vt-station-holo-tools">
          {onClassic && info.classic !== "" && (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={onClassic} data-station-panel-classic>
              Open in classic view
            </Button>
          )}
          <Button size="compact-xs" variant="default" onClick={onClose} data-station-panel-close>
            Close (Esc)
          </Button>
        </span>
      </div>
      <div className="vt-station-holo-body">
        <PanelBoundary name={info.title}>
          <Suspense fallback={<Text p="xl" c="dimmed">Opening {info.title}...</Text>}>{children}</Suspense>
        </PanelBoundary>
      </div>
    </div>
  );
}

/** Shown in the standalone dev page, where the app's pages cannot run. */
export function PanelPlaceholder({ id }: { id: PanelId }) {
  const info = PANELS[id];
  return (
    <Stack align="center" justify="center" h="100%" gap="sm" p="xl" data-station-placeholder={id}>
      <Badge color="orange" variant="light">
        Standalone preview
      </Badge>
      <Text className="vt-station-card-title" fz={26}>
        {info.title}
      </Text>
      <Text size="md" ta="center" maw={620}>
        {info.what}
      </Text>
      <Text size="sm" c="dimmed" ta="center" maw={620}>
        Inside the app this panel shows the real screen{info.classic ? ` (classic view: ${info.classic})` : ""}, fully working. This preview page runs without the app backend, so there is nothing to show here.
      </Text>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Manager (strategy) and docks cards
// ---------------------------------------------------------------------------

const DEMO_PRESETS = [
  { id: "scavenger", name: "Scavenger", facts: "No buying · min profit 3p · undercut 1p" },
  { id: "flipper", name: "Flipper", facts: "Buys up to 60p · min profit 8p · undercut 1p" },
  { id: "high_roller", name: "High Roller", facts: "Buys up to 400p · min profit 25p · undercut 2p" },
  { id: "riven_hunter", name: "Riven Hunter", facts: "Buys up to 150p · min profit 40p · rivens on" },
  { id: "liquidate", name: "Liquidate", facts: "No buying · min profit off · undercut 3p" },
];

/** Stand-in for the strategy controls on the standalone page: same shape, nothing behind it. */
function DemoStrategy() {
  const [preset, setPreset] = useState("flipper");
  const [smart, setSmart] = useState(true);
  return (
    <Stack gap="sm" data-station-demo-strategy>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Group gap="xs" align="baseline">
            <Text fz="xl" fw={700} c="yellow.4">
              1,284p
            </Text>
            <Text c="dimmed">net worth</Text>
            <Badge color="cyan" variant="light">
              Flipper tier
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            76p plat + 1,208p paid for unsold stock · 14 trades left today
          </Text>
        </Stack>
        <Switch label="Smart trader" checked={smart} onChange={(e) => setSmart(e.currentTarget.checked)} />
      </Group>
      <div className="vt-station-presets">
        {DEMO_PRESETS.map((p) => (
          <button key={p.id} type="button" className="vt-station-preset" data-active={p.id === preset} onClick={() => setPreset(p.id)}>
            <Text fw={700}>{p.name}</Text>
            <Text size="xs" c="dimmed">
              {p.facts}
            </Text>
          </button>
        ))}
      </div>
      <Text size="xs" tt="uppercase" c="dimmed">
        Smart trader activity
      </Text>
      <Text size="sm" c="dimmed">
        {smart ? "12:04 · Undercut step raised 1p to 2p: three items have not sold in five days." : "Smart trader is off. The preset values are in use as they are."}
      </Text>
    </Stack>
  );
}

export function ManagerCard({ strategy, trader, onToggleTrader, onClose }: { strategy: ReactNode | null; trader: TraderState; onToggleTrader: () => void; onClose: () => void }) {
  return (
    <Card className="vt-station-card vt-station-card-xl" p="md" data-station-card="manager">
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text className="vt-station-card-title" size="lg">
          The Manager
        </Text>
        <Group gap="xs" wrap="nowrap">
          {!strategy && (
            <Badge color="orange" variant="light">
              Demo
            </Badge>
          )}
          <Badge color={trader.running ? "teal" : "gray"} variant="light">
            Trader {trader.running ? "running" : "stopped"}
          </Badge>
          <Button size="compact-xs" variant="light" color={trader.running ? "red" : "teal"} onClick={onToggleTrader} data-station-manager-toggle>
            {trader.running ? "Stop" : "Start"}
          </Button>
        </Group>
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        "Pick how we trade. I adjust the numbers as the day goes, and tell you why."
      </Text>
      <div className="vt-station-manager-body">
        <PanelBoundary name="The strategy panel">{strategy ?? <DemoStrategy />}</PanelBoundary>
      </div>
      <Group justify="flex-end" mt="xs">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}

export function DocksCard({ trades, mastery, connected, onScanner, onClose }: { trades: number | null; mastery: number | null; connected: boolean; onScanner: () => void; onClose: () => void }) {
  return (
    <Card className="vt-station-card" p="md" data-station-card="docks">
      <Text className="vt-station-card-title" size="lg" mb="xs">
        Docks
      </Text>
      {connected && trades !== null ? (
        <Stack gap={4}>
          <Group gap={6} align="baseline">
            <Text className="vt-station-card-title" fz={28}>
              {trades}
            </Text>
            <Text c="dimmed">trades left today</Text>
          </Group>
          <Text size="sm" c="dimmed">
            Warframe allows one trade per mastery rank each day{mastery ? ` (you are MR ${mastery})` : ""}. The count comes from your inventory link and resets at midnight UTC.
          </Text>
          {trades <= 2 && (
            <Text size="sm" c="orange.4">
              Nearly out: keep the last trades for your best sales.
            </Text>
          )}
        </Stack>
      ) : (
        <Stack gap={6}>
          <Text size="sm">Trades left today are unknown: there is no inventory link yet.</Text>
          <Button size="xs" variant="light" onClick={onScanner}>
            Open the cargo scanner to connect
          </Button>
        </Stack>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Station map (fast travel)
// ---------------------------------------------------------------------------

export function MapOverlay({ current, onTravel, onRoom, onClose }: { current: RoomId; onTravel: (place: Place) => void; onRoom: (room: RoomId) => void; onClose: () => void }) {
  return (
    <div className="vt-station-map" data-station-map>
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Text className="vt-station-card-title" size="lg">
          Station map
        </Text>
        <Group gap="sm" wrap="nowrap">
          <Text size="xs" c="dimmed">
            Click a place to go there
          </Text>
          <CloseButton onClick={onClose} aria-label="Close map" />
        </Group>
      </Group>
      <div className="vt-station-map-grid">
        {ROOM_ORDER.map((room) => (
          <div key={room} className="vt-station-map-room" data-room={room} data-here={room === current}>
            <button type="button" className="vt-station-map-title" onClick={() => onRoom(room)} data-station-map-room={room}>
              <span>{roomName(room)}</span>
              {room === current && <span className="vt-station-map-here">YOU ARE HERE</span>}
            </button>
            <div className="vt-station-map-places">
              {PLACES.filter((p) => p.room === room).map((p) => (
                <button type="button" key={p.label} className="vt-station-map-place" onClick={() => onTravel(p)} data-station-place={p.label}>
                  <span className="vt-station-map-dot" />
                  <span className="vt-station-map-name">{p.label}</span>
                  <span className="vt-station-map-detail">{p.detail}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Text size="xs" c="dimmed" mt="sm" ta="center">
        Doors: Vault to Warehouse (east) and Control Deck (south) · Warehouse to Shop Floor (south) · Control Deck to Shop Floor (east)
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Command palette ("do anything")
// ---------------------------------------------------------------------------

export interface Command {
  id: string;
  label: string;
  /** Where it lives or what it does, shown dimmed. */
  hint: string;
  group: string;
  keywords?: string;
  run: () => void;
}

export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return commands.filter((c) => c.group !== "Stock");
    return commands.filter((c) => {
      const text = `${c.label} ${c.hint} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [commands, query]);
  const active = Math.min(index, Math.max(0, shown.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div className="vt-station-palette" data-station-palette>
      <TextInput
        ref={inputRef}
        size="md"
        placeholder="Do anything: open a screen, go to a room, sell an item..."
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex(Math.min(shown.length - 1, active + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex(Math.max(0, active - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(shown[active]);
          }
        }}
        data-station-palette-input
      />
      <div className="vt-station-palette-list" ref={listRef}>
        {shown.length === 0 && (
          <Text size="sm" c="dimmed" p="sm">
            Nothing matches "{query}".
          </Text>
        )}
        {shown.map((c, i) => (
          <div key={c.id}>
            {(i === 0 || shown[i - 1].group !== c.group) && <div className="vt-station-palette-group">{c.group}</div>}
            <button type="button" className="vt-station-palette-row" data-index={i} data-active={i === active} onMouseEnter={() => setIndex(i)} onClick={() => run(c)} data-station-command={c.id}>
              <span className="vt-station-palette-label">{c.label}</span>
              <span className="vt-station-palette-hint">{c.hint}</span>
            </button>
          </div>
        ))}
      </div>
      <Text size="xs" c="dimmed" mt={6}>
        <kbd>↑</kbd> <kbd>↓</kbd> choose · <kbd>Enter</kbd> run · <kbd>Esc</kbd> close · type an item name to find your stock
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const KEYS: Array<[string[], string]> = [
  [["W", "A", "S", "D"], "Walk (arrows too; in first person A / D strafe, arrows turn)"],
  [["Click"], "Top-down: walk there, or use the thing you clicked. First person: look around with the mouse"],
  [["E"], "Use what is in front of you"],
  [["V"], "Switch between top-down and first person"],
  [["M"], "Station map: jump to any room or terminal"],
  [["K", "/"], "Do anything: open any screen or action by name"],
  [["Tab"], "Warehouse stock list"],
  [["H", "?"], "This help"],
  [["Esc"], "Close what is open (in first person: free the mouse)"],
];

export function HelpOverlay({ fp, startInStation, onStartInStation, lowPower, onLowPower, debugKeys, onClose }: { fp: boolean; startInStation: boolean | null; onStartInStation: (on: boolean) => void; lowPower: boolean; onLowPower: (on: boolean) => void; debugKeys: boolean; onClose: () => void }) {
  return (
    <Card className="vt-station-card vt-station-card-wide" p="md" data-station-help>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text className="vt-station-card-title" size="lg">
          Station controls
        </Text>
        <Badge color="cyan" variant="light">
          {fp ? "First person" : "Top-down"}
        </Badge>
      </Group>
      <div className="vt-station-keys">
        {KEYS.map(([keys, text]) => (
          <div key={text} className="vt-station-keys-row">
            <span className="vt-station-keys-caps">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
            <span>{text}</span>
          </div>
        ))}
        {debugKeys && (
          <div className="vt-station-keys-row">
            <span className="vt-station-keys-caps">
              <kbd>B</kbd>
              <kbd>G</kbd>
            </span>
            <span>Test: send in a pretend buyer / play a pretend sale (nothing is recorded)</span>
          </div>
        )}
      </div>
      <Text size="sm" mt="sm">
        Everything the classic pages do is here: the lever, the shelves, the trade desk and the manager work directly; every terminal opens the real screen. Nothing needs walking: use the map or the "do anything" list.
      </Text>
      <Stack gap={6} mt="sm">
        {startInStation !== null && <Switch size="sm" label="Open the app in the station" checked={startInStation} onChange={(e) => onStartInStation(e.currentTarget.checked)} data-station-start-switch />}
        <Switch size="sm" label="Low power (30 fps, lighter effects)" checked={lowPower} onChange={(e) => onLowPower(e.currentTarget.checked)} />
      </Stack>
      <Group justify="flex-end" mt="sm">
        <Button variant="default" size="xs" onClick={onClose}>
          Close (Esc)
        </Button>
      </Group>
    </Card>
  );
}
