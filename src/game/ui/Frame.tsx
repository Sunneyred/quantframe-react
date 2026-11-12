import type { ReactNode } from "react";
import { CYAN, glyphStripURL } from "../art/textures";

let strip: string | null = null;
const glyphs = () => (strip ??= glyphStripURL(40, CYAN, 18, 5));

/** The common holo-terminal frame: title bar with glyph script, body, and a bezel with the disengage control. */
export function Frame({ title, status, children, onDisengage, hint, className }: { title: string; status?: ReactNode; children: ReactNode; onDisengage?: () => void; hint?: ReactNode; className?: string }) {
  return (
    <div className={`vtg-frame vtg-flicker ${className ?? ""}`}>
      <div className="vtg-head">
        <span className="vtg-title">{title}</span>
        <span className="vtg-glyphs" style={{ backgroundImage: `url(${glyphs()})` }} />
        {status}
      </div>
      <div className="vtg-body">{children}</div>
      <div className="vtg-foot">
        {hint ?? (
          <span>
            <kbd>Esc</kbd> disengage
          </span>
        )}
        {onDisengage && (
          <button type="button" className="vtg-disengage" onClick={onDisengage} data-vtg-disengage>
            Disengage
          </button>
        )}
      </div>
    </div>
  );
}

export const fmt = (n: number) => Math.round(n).toLocaleString();
