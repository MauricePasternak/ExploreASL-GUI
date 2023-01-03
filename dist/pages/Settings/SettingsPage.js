import Box from "@mui/material/Box";
import React from "react";
import { PreferredAestheticsSettings } from "./PreferredAestheticsSettings";
import { PreferredPathsSettings } from "./PreferredPathsSettings";
export function SettingsPage() {
    return (React.createElement(Box, { padding: 2, display: "flex", flexDirection: "column", gap: 2 },
        React.createElement(PreferredAestheticsSettings, null),
        React.createElement(PreferredPathsSettings, null)));
}
//# sourceMappingURL=SettingsPage.js.map