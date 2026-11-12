import React, { useState } from "react";
import { Tooltip, UnstyledButton, Stack } from "@mantine/core";
import { useLocation } from "react-router-dom";
import classes from "./NavbarMinimalColored.module.css";

export type NavbarLinkProps = {
  icon: React.ReactNode;
  label: string;
  link: string;
  id?: string;
  active?: boolean;
  align?: string;
  web?: boolean;
  hide?: boolean;
  onClick?(e: NavbarLinkProps): void;
  onPrefetch?(): void;
};

function NavbarLink(props: NavbarLinkProps) {
  const { icon: Icon, label, active, onClick, onPrefetch } = props;
  return (
    <Tooltip label={label} position="right" transitionProps={{ duration: 0 }}>
      <UnstyledButton
        onClick={() => {
          onClick && onClick(props);
        }}
        onMouseEnter={() => {
          onPrefetch && onPrefetch();
        }}
        onFocus={() => {
          onPrefetch && onPrefetch();
        }}
        className={classes.link}
        data-active={active || undefined}
        data-rainbow-bg={true}
      >
        {Icon}
      </UnstyledButton>
    </Tooltip>
  );
}

export interface NavbarMinimalColoredProps {
  links: NavbarLinkProps[];
}

export function NavbarMinimalColored({ links }: NavbarMinimalColoredProps) {
  const [clicked, setActive] = useState("home");
  // Void Trader: the highlighted entry follows the route, so it is also right after a redirect
  // (the app can start in the station) and after leaving a page without using this bar.
  const { pathname } = useLocation();
  const path = pathname.replace(/^\/+|\/+$/g, "");
  const routed = links.find((link) => !link.web && !link.hide && link.link.replace(/^\/+|\/+$/g, "") === path);
  const active = routed?.id ?? clicked;

  const GetActiveLinkByAlign = (align: "top" | "bottom") => {
    if (!links) return <></>;

    return links
      .filter((link) => link.align == align && !link.hide)
      .map((link) => (
        <NavbarLink
          {...link}
          key={link.label}
          active={link.id === active && !link.web}
          onClick={() => {
            setActive(link.id || "");
            link.onClick && link.onClick(link);
          }}
        />
      ));
  };

  return (
    <nav className={classes.navbar}>
      <div className={classes.navbarMain}>
        <Stack justify="center" gap={3}>
          {GetActiveLinkByAlign("top")}
        </Stack>
      </div>

      <Stack justify="center" gap={0}>
        {GetActiveLinkByAlign("bottom")}
      </Stack>
    </nav>
  );
}

