import React from "react";
import { Link } from "@mui/material";
export function SecureLink(props) {
    return React.createElement(Link, Object.assign({}, props, { target: "_blank", rel: "noopener" }));
}
//# sourceMappingURL=SecureLink.js.map