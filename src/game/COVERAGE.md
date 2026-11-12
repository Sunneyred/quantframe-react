# Ship coverage

Every row of `src/station/COVERAGE.md` (every user-facing function of the app) and where it lives now that the
app is only the 3D game. Nothing is in screen space except the reticle.

- **native**: an in-world object or screen built for the game, calling the same backend command the classic screen calls.
- **embedded**: a Service Deck terminal (`rooms/vault/terminals.ts`, `ui/ServiceDeck.tsx`) that mounts the real
  classic page or component while it is engaged: same component, same contexts, same commands. To be rebuilt
  natively in later stages.
- **Comms**: an app dialog (Mantine modal) shown on the in-world Comms display (`modalRouter.ts`).

Service Deck terminals, left to right along the south windows of the Vault: Captain's Console (account),
Engineering (settings), Overview (Home), Ledger (Trading Analytics), Cargo Scanner (Cargo), Trade Engine
(Live Trading), Order Relay (market orders and auctions), Courier Inbox (Chat), Broadcast Composer (Trade
Messages), Ship's Registry (About), Maintenance Hatch (Debug). The Bridge Watch (clock, alerts) hangs on the
south-west wall.

## Live trader and strategy

| Function | Where in the ship | How |
| --- | --- | --- |
| Start / stop the live trader | Trade Engine | embedded (Live Trading page: `LiveScraperControl`); the "this deletes your orders" confirmation is asked on Comms |
| See whether the trader runs | Trade Engine | embedded (button label) |
| Trader status line (checking item x/y, rate limited, cooldown) | Trade Engine | embedded |
| Strategy: net worth, tier, effective preset | Trade Engine | embedded (`StrategyPanel`) |
| Choose a preset | Trade Engine | embedded |
| Smart trader on/off, strict tiers on/off | Trade Engine | embedded |
| Effective values and smart trader activity feed | Trade Engine | embedded |
| Trades left today | Trade Engine (strategy line), Cargo Scanner (Sell Finder header) | embedded |

## Stock items (sell orders)

| Function | Where in the ship | How |
| --- | --- | --- |
| See stock items with status colours, list price, quantity | Vault: Stock Display (west wall); Market Observatory: gold orbits and cyan rings on the stars; Trade Engine > Items | native (`api.stock_item.getPagination`) + embedded |
| Mark sold at a price and quantity (manual sell) | Stock Display card, Market Console card; Trade Engine > Items row | native (`api.stock_item.sell`) + embedded (dialog on Comms) |
| Mark one sold at the list price (auto sell) | Stock Display card, Market Console card; Trade Engine | native + embedded |
| Edit bought price, owned quantity, minimum price | Stock Display card, Market Console card; Trade Engine | native (`api.stock_item.update`) + embedded |
| Hide / unhide from the trader | Stock Display card, Market Console card; Trade Engine | native + embedded |
| Delete a stock item | Stock Display card, Market Console card; Trade Engine | native (`api.stock_item.delete`) + embedded |
| Record a sale while serving a buyer | Vault: Trade Desk | native (`api.stock_item.sell`) |
| Add a stock item by name | Trade Engine > Items | embedded |
| Add owned inventory to stock | Cargo Scanner > Sell Finder | embedded |
| Filter by status, search, sort, page | Trade Engine > Items | embedded |
| Edit advanced fields (min SMA, min profit, bulk flag, sub type) | Trade Engine > Items | embedded (dialog on Comms) |
| Item info: profitability, market, transactions | Trade Engine > Items; Market Observatory (order book spire, price ribbon, Market Console) | embedded + native |
| Bulk edit, bulk delete | Trade Engine > Items | embedded |
| Generate WTS message for selected items | Trade Engine > Items | embedded |
| Export stock items to JSON | Trade Engine > Items | embedded |
| Bought / listed / profit summary | Trade Engine > Items | embedded |

## Stock rivens

| Function | Where in the ship | How |
| --- | --- | --- |
| See stock rivens with status | Trade Engine > Rivens; Market Console card when the focused star is a riven weapon in stock | embedded + native |
| Mark sold at a price / at the list price | Trade Engine > Rivens; Market Console riven card | embedded + native (`api.stock_riven.sell`) |
| Edit bought price and minimum price | Trade Engine > Rivens; Market Console riven card | embedded + native |
| Hide / unhide, delete | Trade Engine > Rivens; Market Console riven card | embedded + native |
| Add a riven, edit match filter, riven details (grades, rolls, kuva, endo, market) | Trade Engine > Rivens | embedded |
| Bulk edit / delete, WTS message, export | Trade Engine > Rivens | embedded |

## Wish list (buy orders)

| Function | Where in the ship | How |
| --- | --- | --- |
| See wish list entries with status and maximum price | Trade Engine > Wish list; dashed violet rings on the Observatory's stars | embedded + native |
| Mark bought at a price and quantity / at the order price | Trade Engine > Wish list; Market Console wish card of the focused item | embedded + native (`api.wish_list.bought`) |
| Edit quantity and maximum price | Trade Engine > Wish list; Market Console wish card | embedded + native |
| Hide / unhide, delete | Trade Engine > Wish list; Market Console wish card | embedded + native |
| Add an entry, info, bulk edit / delete, WTB message, export | Trade Engine > Wish list | embedded |

## Syndicate items

| Function | Where in the ship | How |
| --- | --- | --- |
| Syndicate items table: import, sell, edit, delete, export, filters (dev-only tab, as in the classic view) | Trade Engine > Syndicates | embedded (same dev-only rule) |

## Home dashboard

| Function | Where in the ship | How |
| --- | --- | --- |
| Plat balance against the goal | Vault: the Plat Reservoir and its lectern readout; ticker ring | native (`api.wf_inventory.platGoal`) |
| Profit today against the daily target | Reservoir readout; ticker ring | native |
| Total / today / best seller cards | Overview | embedded (Home) |
| Profit charts (year, today, recent days) | Overview | embedded |
| Latest transactions, best by category | Overview | embedded |

## Market orders and auctions

| Function | Where in the ship | How |
| --- | --- | --- |
| Orders: list, filter, refresh | Order Relay > Orders | embedded |
| Orders: bought / sold (manual and auto), add to stock, info, blacklist, delete, delete all | Order Relay > Orders | embedded (dialogs on Comms) |
| Auctions: list, refresh, import into stock, info, delete, delete all | Order Relay > Auctions | embedded |

## Chat and buyers

| Function | Where in the ship | How |
| --- | --- | --- |
| A buyer messaged you | Vault: a customer walks to the Trade Desk; PA display and ticker ring announce it | native (`Wfm:OnChatMessage`, `vt_whisper`) |
| Copy whisper / invite command for a buyer | Trade Desk | native |
| Read chats, reply, search, refresh | Courier Inbox | embedded (Chat) |
| Delete a chat / all chats | Courier Inbox | embedded |

## Trading analytics

| Function | Where in the ship | How |
| --- | --- | --- |
| Transactions: list and chart views, filters | Ledger > Transactions | embedded |
| Transactions: edit, delete, bulk delete, export, tax calculation, financial report | Ledger > Transactions | embedded |
| Item prices table and export | Ledger > Items; Market Observatory (Orrery, price ribbon) | embedded + native |
| Syndicate prices | Ledger > Syndicates | embedded |
| Riven prices, riven market scan (start, status, stop), export | Ledger > Rivens | embedded |
| Trading partners | Ledger > Users | embedded |
| Game data import (overview, purchases, trades, transactions) | Ledger > WFGDPR | embedded |
| A sale happened | Vault: gold pours into the Reservoir; PA display and ticker ring | native (`add_trade` event, balance poll) |

## Cargo (inventory)

| Function | Where in the ship | How |
| --- | --- | --- |
| Sell Finder list, values, search | Cargo Scanner > Sell Finder; inventory halos on the Observatory's stars | embedded + native |
| Rescan the inventory | Cargo Scanner | embedded |
| Connect the inventory source | Cargo Scanner | embedded |
| Minimum price filter, full Sell Finder table | Cargo Scanner | embedded |
| Inventory rivens: list, predicted price, add to stock | Cargo Scanner > Rivens | embedded |

## Trade messages

| Function | Where in the ship | How |
| --- | --- | --- |
| Item trade entries: add, edit, price, bulk edit / delete, export, calibrate prices | Broadcast Composer > Items | embedded |
| Custom entries | Broadcast Composer > Custom | embedded |
| Riven entries, find interesting rivens | Broadcast Composer > Rivens | embedded |
| Generate and copy WTS / WTB messages | Broadcast Composer | embedded |

## Settings, account, app

| Function | Where in the ship | How |
| --- | --- | --- |
| All settings (general, live trading, appearance and themes, notifications, advanced) | Engineering | embedded (`SettingsForm`, saved with `api.app.updateSettings` + the refresh event, as the user menu does) |
| Change language | Engineering > General | embedded |
| Market status (online / in game / invisible) | Captain's Console | embedded-style console: `api.user.set_status` |
| Log out | Captain's Console | `api.auth.logout`, same confirmation (on Comms); the login page follows |
| Connection lost warning | Captain's Console | same condition as the user menu |
| Alerts ticker (click opens link) | Bridge Watch (south-west wall): alert list; engage it to open a link | native (`AppContext.alerts`, shell `open`) |
| Clock (UTC and time to reset) | Bridge Watch | embedded (the app's `Clock` component) |
| Notifications (toasts) | PA display and ticker ring; the foot of the engaged terminal | native (`notify.ts`: capture of Mantine's store; the screen-space toasts are hidden) |
| Update available / terms dialogs | Comms display, placed in front of the player; cannot be dismissed with Esc, as in the classic view | Comms |
| About: guide, community links, version, check for updates | Ship's Registry | embedded (About) |
| Debug: command logging, states, debugging helpers, log reader | Maintenance Hatch (always there) | embedded (Debug) |
| Login, error and banned screens | unchanged, before the ship (you are not aboard while logged out) | by design |
| Render quality, camera (first / third person), render figures | Vault: Fidelity Console and its lever | native |

## The shell itself

| Function | Where | How |
| --- | --- | --- |
| The app opens in the ship | every logged-in route renders the game (`components/Layouts/Routes.tsx`, `GameShell.tsx`) | - |
| Classic view (fallback) | hidden: entered when the game crashes, has no WebGL, draws no first frame or loses its context, or with Ctrl+Shift+F12; remembered until "Return to the ship" (the star at the top of the classic side bar) | `shellMode.ts` |
| The old 2D station | classic view only, from its side bar ("Station (2D, being replaced)") | unchanged |
| Station map / "do anything" palette / help overlay | not in the ship (screen-space overlays); the terminals are found by walking: the deck is one row | later stage |

## Not covered, or different

- The classic header's avatar, logo and side bar do not exist in the ship; their functions are on the Captain's
  Console, the Bridge Watch and the Service Deck.
- The unread-chat badge of the side bar: the Captain's Console shows the unread count when engaged; a buyer's
  message still walks a customer to the Trade Desk.
- Embedded pages are mounted only while their terminal is engaged (and while one of their dialogs is on Comms).
  Disengaging unmounts the page: unsaved form input on it is lost, as when leaving a classic route.
