import { useEffect, useState } from "react";
import { useMantineColorScheme, Center, Loader, Stack, Title } from "@mantine/core";
import { Route, Routes, useLocation } from "react-router";

import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import UpdateManager from "./components/UpdateManager";
import SettingsModal from "./components/settings/SettingsModal";
import LandingPage from "./pages/LandingPage";
import ProjectPage from "./pages/ProjectPage";
import OverviewPage from "./pages/OverviewPage";
import { useGlobalStore } from "./stores/globalStore";
import { logAction } from "./lib/debug";

export interface AppE2EOptions {
  enabled: true;
  onReady: (location: ReturnType<typeof useLocation>) => void;
}

export interface AppProps {
  e2e?: AppE2EOptions;
}

export default function App({ e2e }: AppProps) {
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
  const loaded = useGlobalStore((state) => state.loaded);
  const theme = useGlobalStore((state) => state.settings.theme);
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    if (e2e?.enabled) return;
    void loadSettings();
  }, [e2e?.enabled, loadSettings]);

  useEffect(() => {
    if (loaded) {
      setColorScheme(theme);
    }
  }, [setColorScheme, theme, loaded]);

  useEffect(() => {
    if (loaded && e2e?.enabled) {
      e2e.onReady(location);
    }
  }, [e2e, loaded, location]);

  if (!loaded) {
    return (
      <Center style={{ height: "100vh", width: "100vw" }} data-testid="app-loading-gate">
        <Stack align="center" gap="md">
          <Title order={1}>ExploreASL GUI</Title>
          <Loader size="xl" />
        </Stack>
      </Center>
    );
  }

  return (
    <ErrorBoundary>
      <div data-testid="app-ready">
        <Routes>
          <Route element={<Layout onOpenSettings={() => setSettingsOpen(true)} />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/project/:id/:phase" element={<ProjectPage />} />
            <Route path="/overview" element={<OverviewPage />} />
          </Route>
        </Routes>

        <UpdateManager enabled={e2e?.enabled ? false : undefined} />

        {settingsOpen && (
          <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
