import { useEffect, useState } from "react";
import { useMantineColorScheme } from "@mantine/core";
import { Route, Routes, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";

import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import SettingsModal from "./components/SettingsModal";
import LandingPage from "./pages/LandingPage";
import ProjectPage from "./pages/ProjectPage";
import OverviewPage from "./pages/OverviewPage";
import { useGlobalStore } from "./stores/globalStore";
import { logAction } from "./lib/debug";

export default function App() {
  const location = useLocation();

  useEffect(() => {
    logAction("navigation_change", {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSettings = useGlobalStore((state) => state.loadSettings);
  const theme = useGlobalStore((state) => state.settings.theme);
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    async function initialize() {
      await loadSettings();

      const state = useGlobalStore.getState();
      const exploreAslPath = state.settings.exploreAslPath;
      if (exploreAslPath.trim().length > 0) {
        try {
          const version = await invoke<string | null>("detect_exploreasl_version", {
            exploreAslPath,
          });
          state.setExploreAslVersion(version);
        } catch {
          // path may not exist; version detection is best-effort
        }
      }
    }

    void initialize();
  }, [loadSettings]);

  useEffect(() => {
    setColorScheme(theme);
  }, [setColorScheme, theme]);

  return (
    <ErrorBoundary>
      <>
        <Routes>
          <Route element={<Layout onOpenSettings={() => setSettingsOpen(true)} />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
            <Route path="/overview" element={<OverviewPage />} />
          </Route>
        </Routes>

        <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </>
    </ErrorBoundary>
  );
}
