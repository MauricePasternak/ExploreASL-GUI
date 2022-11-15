import React from "react";
import { Link, LinkProps } from "@mui/material";

export function SecureLink(props: Omit<LinkProps, "target" | "rel">) {
  return <Link {...props} target="_blank" rel="noopener" />;
}
