# Station coverage

Every user-facing function of the app, where it lives in the classic view, and where it lives in the station.

- **native**: a station object with its own in-world card, calling the same backend command the classic screen calls.
- **embedded**: a station terminal that opens the real classic page or component in a holo panel (same component, same contexts, same commands).
- **shell**: part of the app frame (header, side bar, notifications, dialogs) that stays on screen while the station is open.

Nothing needs walking: `M` (map) teleports to any room or terminal, `K` or `/` ("do anything") opens any function by name. Rooms: Vault, Warehouse, Control Deck, Shop Floor.

Status: **ok (demo)** = exercised in the standalone dev page on demo data; **ok (read)** = the real component is mounted unchanged and was checked by reading the code, it cannot run outside Tauri; **gap** = not covered.

## Live trader and strategy

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Start / stop the live trader | Live Trading page, start/stop button (`LiveScraperControl`) | Control Deck: trader lever (also the Start/Stop button on the manager card, and "do anything") | native: `api.live_scraper.toggle()`, with the same "this deletes your orders" confirmation when auto-delete is on | ok (demo); real call ok (read) |
| See whether the trader runs | same button label | Control Deck wall display RUNNING / OFFLINE, lever position, console lamps, footer badge | native: `LiveScraperContext.is_running` | ok (demo) |
| Trader status line (checking item x/y, rate limited, cooldown) | text under the button | Control Deck wall display, second line | native: `LiveScraperContext.message`, translated with the same keys | ok (demo); real text ok (read) |
| Strategy: net worth, tier, effective preset | Live Trading page, `StrategyPanel` | Control Deck: the manager | embedded component (`StrategyPanel`) inside the manager card | ok (read); demo stand-in in dev |
| Choose a preset | `StrategyPanel` | manager card | embedded component | ok (read) |
| Smart trader on/off, strict tiers on/off | `StrategyPanel` | manager card | embedded component | ok (read) |
| Effective values and smart trader activity feed | `StrategyPanel` | manager card | embedded component | ok (read) |
| Trades left today | `StrategyPanel` text, Sell Finder header | Control Deck: docks board on the wall (number and pips), docks card; also the Warehouse display | native: `SellFinderResult.trades_remaining` | ok (demo) |

## Stock items (sell orders)

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| See stock items with status colours, list price, quantity | Live Trading > Items table | Shop Floor: shelves STOCK A/B/C, one crate per item (colour = status, size = quantity, tag = list price); 30 on shelves, the rest at the stock desk | native: `api.stock_item.getPagination` | ok (demo) |
| Mark sold at a price and quantity (manual sell) | Items row, pen button | stock card: Sell > Record sale | native: `api.stock_item.sell` with the same payload | ok (demo) |
| Mark one sold at the list price (auto sell) | Items row, hammer button | stock card: "Sold one at the list price" | native: `api.stock_item.sell` | ok (demo) |
| Edit bought price, owned quantity, minimum price | Items row, edit button and minimum price column | stock card: Edit > Save | native: `api.stock_item.update` | ok (demo) |
| Hide / unhide from the trader | Items row, eye button | stock card: Edit > Hide / Show | native: `api.stock_item.update({ is_hidden })` | ok (demo) |
| Delete a stock item | Items row, bin button | stock card: Edit > Delete (two clicks) | native: `api.stock_item.delete` | ok (demo) |
| Record a sale while serving a buyer | (no direct equivalent: you go to the Items table and press sell) | Vault trade desk: customer card > "Record the sale" (item pre-picked from the buyer's message) | native: `api.stock_item.sell` | ok (demo) |
| Add a stock item by name | Items tab, create form | Shop Floor: stock desk | embedded page (Live Trading) | ok (read) |
| Add owned inventory to stock | Cargo > Sell Finder, "Add to stock" | Warehouse: crates, bay terminals, stock list (Tab) | native: `api.stock_item.create` | ok (demo) |
| Filter by status, search, sort, page | Items tab | stock desk | embedded page | ok (read) |
| Edit advanced fields (min SMA, min profit, bulk flag, sub type) | Items row, edit modal | stock desk | embedded page | ok (read) |
| Item info: profitability, market, transactions | Items row, info button | stock desk | embedded page | ok (read) |
| Bulk edit, bulk delete | Items tab toolbar | stock desk | embedded page | ok (read) |
| Generate WTS message for selected items | Items tab toolbar | stock desk | embedded page | ok (read) |
| Export stock items to JSON | Items tab toolbar | stock desk | embedded page | ok (read) |
| Bought / listed / profit summary | Items tab, segments | stock desk; Shop Floor wall display shows listed value and live count | embedded page (+ native summary) | ok (read) |

## Stock rivens

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| See stock rivens with status | Live Trading > Rivens table | Shop Floor: riven display case (8 slots, rest at the stock desk) | native: `api.stock_riven.getPagination` | ok (demo) |
| Mark sold at a price / at the list price | Rivens row, pen and hammer buttons | riven card: Sell | native: `api.stock_riven.sell` with the same payload | ok (demo) |
| Edit bought price and minimum price | Rivens row | riven card: Edit > Save | native: `api.stock_riven.update` | ok (demo) |
| Hide / unhide, delete | Rivens row | riven card: Edit | native: `api.stock_riven.update` / `delete` | ok (demo) |
| Add a riven, edit match filter, riven details (grades, rolls, kuva, endo, market) | Rivens tab | stock desk | embedded page | ok (read) |
| Bulk edit / delete, WTS message, export | Rivens tab toolbar | stock desk | embedded page | ok (read) |

## Wish list (buy orders)

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| See wish list entries with status and maximum price | Live Trading > Wish list table | Shop Floor: "wanted" posters on the back wall (6, rest at the stock desk) | native: `api.wish_list.getPagination` | ok (demo) |
| Mark bought at a price and quantity / at the order price | Wish list row | wish card: Bought | native: `api.wish_list.bought` | ok (demo) |
| Edit quantity and maximum price | Wish list row | wish card: Edit > Save | native: `api.wish_list.update` | ok (demo) |
| Hide / unhide, delete | Wish list row | wish card: Edit | native: `api.wish_list.update` / `delete` | ok (demo) |
| Add an entry, info, bulk edit / delete, WTB message, export | Wish list tab | stock desk | embedded page | ok (read) |

## Syndicate items

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Syndicate items table: import, sell, edit, delete, export, filters (tab is dev-only in the classic view too) | Live Trading > Syndicates | stock desk | embedded page (same dev-only rule) | ok (read) |

## Home dashboard

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Plat balance against the goal | Home, `PlatGoalBar` | Vault: the tank and its wall readout, tank card | native: `api.wf_inventory.platGoal` | ok (demo) |
| Profit today against the daily target | Home, `PlatGoalBar` | Vault readout, Control Deck overview plate | native | ok (demo) |
| Total / today / best seller cards | Home | Control Deck: overview screen | embedded page (Home) | ok (read) |
| Profit charts (year, today, recent days) | Home | overview screen | embedded page | ok (read) |
| Latest transactions, best by category | Home | overview screen | embedded page | ok (read) |

## warframe.market

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Orders: list, filter, refresh | Warframe Market > Orders | Shop Floor: market terminal | embedded page | ok (read) |
| Orders: bought / sold (manual and auto), add to stock, info, blacklist, delete, delete all | Warframe Market > Orders | market terminal | embedded page | ok (read) |
| Auctions: list, refresh, import into stock, info, delete, delete all | Warframe Market > Auctions | market terminal | embedded page | ok (read) |

## Chat and buyers

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| A buyer messaged you | Chat page, unread badge in the side bar | Vault: a customer walks to the trade desk; the comms terminal screen flashes while messages are unread | native: `Wfm:OnChatMessage`, `vt_whisper` events | ok (demo) |
| Copy whisper / invite command for a buyer | (none) | customer card | native | ok (demo) |
| Read chats, reply, search, refresh | Chat page | Control Deck: comms terminal | embedded page | ok (read) |
| Delete a chat / all chats | Chat page | comms terminal | embedded page | ok (read) |

## Trading analytics

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Transactions: list and chart views, filters | Trading Analytics > Transactions | Vault: ledger terminal | embedded page | ok (read) |
| Transactions: edit, delete, bulk delete, export, tax calculation, financial report | Trading Analytics > Transactions | ledger terminal | embedded page | ok (read) |
| Item prices table and export | Trading Analytics > Items | ledger terminal | embedded page | ok (read) |
| Syndicate prices | Trading Analytics > Syndicates | ledger terminal | embedded page | ok (read) |
| Riven prices, riven market scan (start, status, stop), export | Trading Analytics > Rivens | ledger terminal | embedded page | ok (read) |
| Trading partners | Trading Analytics > Users | ledger terminal | embedded page | ok (read) |
| Warframe GDPR import (overview, purchases, trades, transactions) | Trading Analytics > WFGDPR | ledger terminal | embedded page | ok (read) |
| A sale happened | transactions refresh | Vault: gold pours into the tank, "+Np" floater | native: `add_trade` event, balance poll | ok (demo) |

## Cargo (inventory)

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Sell Finder list, values, search | Cargo > Sell Finder | Warehouse: crates by bay, bay terminals, stock list (Tab) | native: `api.wf_inventory.sellFinder` | ok (demo) |
| Rescan the inventory | Sell Finder, Rescan | stock list > Rescan, "do anything" | native: `api.wf_inventory.refresh` | ok (demo) |
| Connect AlecaFrame | Sell Finder, Connect button | Warehouse: cargo scanner | embedded page (Cargo) | ok (read) |
| Minimum price filter, full Sell Finder table | Sell Finder | cargo scanner | embedded page | ok (read) |
| Inventory rivens: list, predicted price, add to stock | Cargo > Rivens | cargo scanner | embedded page | ok (read) |

## Trade messages

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Item trade entries: add, edit, price, bulk edit / delete, export, calibrate prices | Trade Messages > Items | Control Deck: trade chat terminal | embedded page | ok (read) |
| Custom entries | Trade Messages > Custom | trade chat terminal | embedded page | ok (read) |
| Riven entries, find interesting rivens | Trade Messages > Rivens | trade chat terminal | embedded page | ok (read) |
| Generate and copy WTS / WTB messages | Trade Messages | trade chat terminal | embedded page | ok (read) |

## Settings, account, app

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| All settings (general, live trading incl. item / riven / syndicate, appearance and themes, notifications, advanced: HTTP server, logs, inventory source) | user menu > Settings (modal with `SettingsForm`) | Control Deck: engineering terminal | embedded component (`SettingsForm`), saved with the same `api.app.updateSettings` + refresh event | ok (read) |
| Change language | Settings > General | engineering terminal | embedded component | ok (read) |
| warframe.market status (online / in game / invisible) | user menu | Control Deck: captain's console; header avatar still on screen | native-style console: `api.user.set_status` | ok (read) |
| Log out | user menu | captain's console; header avatar | native-style console: `api.auth.logout`, same confirmation | ok (read) |
| Connection lost warning | user menu | captain's console; header avatar | native-style console + shell | ok (read) |
| Alerts ticker (click opens link) | header | header stays on screen above the station | shell | ok (read) |
| Clock (UTC and time to reset) | header | header stays on screen | shell | ok (read) |
| Notifications (toasts) | bottom right | unchanged, shown over the station | shell | ok (read) |
| Update available / terms dialogs | app dialogs | unchanged, shown over the station (station keys are ignored while a dialog is open) | shell | ok (read) |
| About: guide, Discord, coffee, Patreon links, version, check for updates | About page | Control Deck: info plaque | embedded page | ok (read) |
| Debug: command logging, states, debugging helpers, EE.log reader | Debug page (dev or Shift) | Control Deck: maintenance hatch (always available) | embedded page | ok (read) |
| Login, error and banned screens | separate layouts before login | not in the station (you cannot be in the station while logged out) | - | by design |

## Station itself

| Function | Classic UI | Station | How | Status |
| --- | --- | --- | --- | --- |
| Open the app in the station | - | Help (H) switch, "do anything"; default on. First landing on Home after launch goes to `/station` | `localStorage vt_station_start`, `StationStartGate` on the home route | ok (read) |
| Leave to the classic view, and come back | side bar | footer "Classic view", captain's console, "do anything", "Open in classic view" on each panel; back with the Station button at the top of the side bar | router | ok (read) |
| Top-down / first person, low power | - | V, footer | native | ok (demo) |
| Map / fast travel, "do anything", help | - | M, K or /, H or ? | native | ok (demo) |

## Not covered, or different

- **Editing a list price by hand** is not offered on the stock card: the classic table does not offer it either (the trader sets it; you set the minimum).
- **Item / riven info modals, match filter, bulk actions, WTS/WTB generation, export, add-by-name forms** are not rebuilt natively; the stock desk opens the full Live Trading page for them.
- **Shelves show a limited number**: 30 stock items, 8 rivens, 6 wanted posters (ordered live first, then by price). The stock desk has all of them; "do anything" finds every one of the first 200 by name.
- The task brief mentions a start/stop control in the header. In this code base the control lives on the Live Trading page (`LiveScraperControl`); the lever uses exactly its calls.
