import { useEffect, useState } from "react";
import { useMantineColorScheme } from "@mantine/core";
import { Route, Routes } from "react-router";

import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import SettingsModal from "./components/SettingsModal";
import LandingPage from "./pages/LandingPage";
import ProjectPage from "./pages/ProjectPage";
import { useGlobalStore } from "./stores/globalStore";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadSettings = useGlobalStore((state) => state.loadSettings);
  const theme = useGlobalStore((state) => state.settings.theme);
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    async function initialize() {
      await loadSettings();
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
          </Route>
        </Routes>

        <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </>
    </ErrorBoundary>
  );
}
