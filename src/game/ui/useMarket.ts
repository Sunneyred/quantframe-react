import type { MarketStar, OrderBook, PriceHistory } from "@api/market";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../station/data/bridge";
import type { ShopData } from "../../station/engine/shop";
import { fetchBook, fetchHistory, fetchMarket, type MarketResult } from "../market/data";
import { NO_FILTER, plat, type MarketFilter } from "../market/layout";
import { makeAnnouncement, type Announcement } from "../notify";
import type { ObservatoryRoom } from "../rooms/observatory";

/**
 * The observatory's data flow: the market overview (re-read when the shop changes), the focused
 * item, its order book (on focus, then every BOOK_MS while focused and the page is visible; the
 * backend caches each book ~40 s and spaces its requests) and its price history. An undercut that
 * appears between two reads is announced in the room.
 */

const BOOK_MS = 45000;

export interface MarketState {
  market: MarketResult | null;
  filter: MarketFilter;
  focus: MarketStar | null;
  book: OrderBook | null;
  bookLoading: boolean;
  bookError: string | null;
  history: PriceHistory | null;
  historyLoading: boolean;
  variant: string | undefined;
}

export function useMarket(room: ObservatoryRoom | null, shop: ShopData | null, announce: (a: Announcement) => void) {
  const [market, setMarket] = useState<MarketResult | null>(null);
  const [filter, setFilter] = useState<MarketFilter>(NO_FILTER);
  const [focus, setFocusState] = useState<MarketStar | null>(null);
  const [book, setBook] = useState<OrderBook | null>(null);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [variant, setVariant] = useState<string | undefined>(undefined);
  const shopRef = useRef(shop);
  shopRef.current = shop;
  const focusRef = useRef<MarketStar | null>(null);
  const bookSeq = useRef(0);
  const lastBook = useRef<OrderBook | null>(null);
  const marketSeq = useRef(0);

  // --- the overview: on mount and whenever the shop changes (flags follow stock and wishes)
  const loadMarket = useCallback(async () => {
    const seq = ++marketSeq.current;
    const res = await fetchMarket(shopRef.current);
    if (seq === marketSeq.current) setMarket(res);
  }, []);
  const shopKey = shop ? `${shop.items.map((i) => `${i.wfm_url}:${i.status}:${i.is_hidden}`).join(",")}|${shop.wishes.map((w) => w.wfm_url).join(",")}|${shop.rivens.map((r) => `${r.wfm_weapon_url}:${r.status}`).join(",")}` : "";
  useEffect(() => {
    const id = window.setTimeout(() => void loadMarket(), shopKey ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [loadMarket, shopKey]);

  useEffect(() => {
    if (!room || !market) return;
    room.setItems(market.overview.items);
    // keep the focus on the same item with its fresh numbers
    const f = focusRef.current;
    if (f) {
      const fresh = market.overview.items.find((i) => i.wfm_url === f.wfm_url && i.flags.riven === f.flags.riven) ?? null;
      if (fresh) {
        focusRef.current = fresh;
        setFocusState(fresh);
        room.setFocus(fresh);
      }
    }
  }, [room, market]);

  useEffect(() => {
    room?.setFilter(filter);
  }, [room, filter]);

  // --- the order book
  const loadBook = useCallback(
    async (force = false) => {
      const s = focusRef.current;
      if (!s) return;
      const seq = ++bookSeq.current;
      setBookLoading(true);
      room?.setBook(null, true);
      try {
        const b = await fetchBook(s, shopRef.current, { variant, force });
        if (seq !== bookSeq.current || focusRef.current?.wfm_url !== s.wfm_url) return;
        const prev = lastBook.current;
        const fresh = !prev || prev.wfm_url !== b.wfm_url ? null : prev;
        if (b.summary.undercut_by && (!fresh || !fresh.summary.undercut_by)) {
          const under = b.sells.find((o) => !o.own && o.status === "ingame" && o.platinum === b.summary.best_sell_ingame);
          announce(makeAnnouncement(`Undercut · ${s.name}`, `${under?.user ?? "Someone"} sells at ${plat(b.summary.best_sell_ingame)}, ${plat(b.summary.undercut_by)} under your ${plat(b.summary.own_sell)}.`, "red"));
        }
        lastBook.current = b;
        setBook(b);
        setBookError(null);
        room?.setBook(b);
      } catch (e) {
        if (seq !== bookSeq.current) return;
        setBookError(errorText(e));
        room?.setBook(lastBook.current?.wfm_url === s.wfm_url ? lastBook.current : null);
      } finally {
        if (seq === bookSeq.current) setBookLoading(false);
      }
    },
    [room, variant, announce],
  );

  const setFocus = useCallback(
    (s: MarketStar | null) => {
      if (s && focusRef.current && s.wfm_url === focusRef.current.wfm_url && s.flags.riven === focusRef.current.flags.riven) return;
      focusRef.current = s;
      setFocusState(s);
      setBook(null);
      setBookError(null);
      setHistory(null);
      setVariant(undefined);
      lastBook.current = null;
      bookSeq.current++;
      room?.setFocus(s);
    },
    [room],
  );

  // load the book on focus (and variant change), then poll while focused
  useEffect(() => {
    if (!focus) return;
    void loadBook(false);
    const id = window.setInterval(() => {
      if (!document.hidden) void loadBook(false);
    }, BOOK_MS);
    return () => window.clearInterval(id);
    // the focused url and the variant drive this; loadBook changes with them
  }, [focus?.wfm_url, focus?.flags.riven, variant, loadBook]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- price history, once per focus
  useEffect(() => {
    const s = focusRef.current;
    if (!s) return;
    let alive = true;
    setHistoryLoading(true);
    room?.setHistory(s, null, true);
    fetchHistory(s, variant)
      .then((h) => {
        if (!alive) return;
        setHistory(h);
        room?.setHistory(s, h);
      })
      .catch((e) => {
        if (!alive) return;
        console.warn("[game] price history failed", e);
        room?.setHistory(s, null);
      })
      .finally(() => alive && setHistoryLoading(false));
    return () => {
      alive = false;
    };
  }, [room, focus?.wfm_url, focus?.flags.riven, variant]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusUrl = useCallback(
    (url: string, riven = false) => {
      const s = market?.overview.items.find((i) => i.wfm_url === url && (riven ? i.flags.riven : true)) ?? null;
      if (s) setFocus(s);
      return s;
    },
    [market, setFocus],
  );

  const state: MarketState = { market, filter, focus, book, bookLoading, bookError, history, historyLoading, variant };
  return { state, setFilter, setFocus, focusUrl, refreshBook: () => void loadBook(true), reloadMarket: loadMarket, setVariant };
}
