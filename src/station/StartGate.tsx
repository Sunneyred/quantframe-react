import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { markStarted, shouldRedirectToStation } from "./startup";

/**
 * Wraps the home route. On the first landing after launch it sends the user to
 * the station when "Open the app in the station" is on; after that it is
 * transparent, so the Home link and "Classic view" show the home page.
 */
export function StationStartGate({ children }: { children: ReactNode }) {
  const redirect = shouldRedirectToStation();
  useEffect(() => {
    markStarted();
  }, []);
  return redirect ? <Navigate to="/station" replace /> : <>{children}</>;
}
