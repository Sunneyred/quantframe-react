import { notificationsStore, type NotificationData } from "@mantine/notifications";
import { isValidElement, useEffect, type ReactNode } from "react";

/**
 * In-world announcements, and the capture of the app's Mantine notifications while the game is
 * mounted. Nothing in the app changes: the game subscribes to Mantine's notifications store (the
 * same store `notifications.show()` writes to) and mirrors every new or updated notification
 * onto the ticker ring and the PA display. The app's own <Notifications /> stays mounted and keeps
 * running its timers, but a style tag hides its screen-space root until the game unmounts.
 */

export type Tone = "gold" | "cyan" | "green" | "red";

export interface Announcement {
  id: string;
  title: ReactNode;
  message: ReactNode;
  /** Plain text for the ticker ring (canvas). */
  text: string;
  tone: Tone;
  at: number;
}

let seq = 0;
export function makeAnnouncement(title: ReactNode, message: ReactNode, tone: Tone = "cyan"): Announcement {
  const t = plain(title);
  const m = plain(message);
  return { id: `a${++seq}-${Date.now()}`, title, message, text: [t, m].filter(Boolean).join(" · ") || "Notice", tone, at: Date.now() };
}

/** Best-effort plain text of a React node (strings, numbers, arrays, elements' children). */
export function plain(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plain).join("");
  if (isValidElement(node)) return plain((node.props as { children?: ReactNode }).children);
  return "";
}

function toneOf(color: NotificationData["color"]): Tone {
  const c = String(color ?? "");
  if (c.startsWith("red")) return "red";
  if (c.startsWith("green") || c.startsWith("teal")) return "green";
  if (c.startsWith("yellow") || c.startsWith("orange")) return "gold";
  return "cyan";
}

const HIDE_CSS = ".mantine-Notifications-root { display: none !important; }";

export function useNotificationCapture(onAnnounce: (a: Announcement) => void) {
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.vtgNotifications = "hidden";
    style.textContent = HIDE_CSS;
    document.head.appendChild(style);
    const seen = new Map<string, string>();
    const handle = (state: { notifications: NotificationData[]; queue: NotificationData[] }) => {
      for (const n of [...state.notifications, ...state.queue]) {
        const id = n.id ?? "";
        const sig = `${plain(n.title)}|${plain(n.message)}|${n.loading ? 1 : 0}`;
        if (seen.get(id) === sig) continue;
        seen.set(id, sig);
        onAnnounce(makeAnnouncement(n.title ?? "", n.message, toneOf(n.color)));
      }
    };
    // anything already showing when the game opened counts too
    handle(notificationsStore.getState());
    const unsubscribe = notificationsStore.subscribe(handle);
    return () => {
      unsubscribe();
      style.remove();
    };
    // the callback is stable (see GameCore)
  }, [onAnnounce]);
}
