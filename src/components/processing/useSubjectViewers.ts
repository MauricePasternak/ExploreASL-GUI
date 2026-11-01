import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLogContent,
  fetchModuleLogs,
  type LogContent,
  type LogFileInfo,
} from "../../lib/logViewer";
import { fetchSubjectReports } from "../../lib/reportViewer";

type SubjectModule = "structural" | "asl";

/** Caller-local discovery and modal state; QC also refreshes after phase changes. */
export function useSubjectViewers(projectRoot: string | undefined, processingPhase?: string) {
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([]);
  const [modalOpened, setModalOpened] = useState(false);
  const [modalModule, setModalModule] = useState<SubjectModule>("structural");
  const [modalSubjectSession, setModalSubjectSession] = useState("");
  const [modalContent, setModalContent] = useState<LogContent | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [existingReports, setExistingReports] = useState<Set<string>>(new Set());
  const [reportModalOpened, setReportModalOpened] = useState(false);
  const [reportModalModule, setReportModalModule] = useState<SubjectModule>("structural");
  const [reportModalSubjectSession, setReportModalSubjectSession] = useState("");
  const [reportModalRuns, setReportModalRuns] = useState<string[]>([]);

  useEffect(() => {
    if (!projectRoot) return;
    fetchModuleLogs(projectRoot)
      .then(setLogFiles)
      .catch((err) => {
        console.warn("Failed to fetch module logs:", err);
        setLogFiles([]);
      });
  }, [projectRoot, processingPhase]);

  useEffect(() => {
    if (!projectRoot) return;
    fetchSubjectReports(projectRoot)
      .then((reports) => {
        setExistingReports(new Set(reports.map((r) => `${r.subjectSession}:${r.module}`)));
      })
      .catch((err) => {
        console.error("Failed to fetch reports list:", err);
        setExistingReports(new Set());
      });
  }, [projectRoot, processingPhase]);

  const { structural: structuralLogInfo, asl: aslLogInfo } = useMemo(() => {
    const indexes = {
      structural: new Map<string, LogFileInfo[]>(),
      asl: new Map<string, LogFileInfo[]>(),
    };
    for (const file of logFiles) {
      if (file.module !== "structural" && file.module !== "asl") continue;
      const index = indexes[file.module];
      const files = index.get(file.subjectSession) ?? [];
      files.push(file);
      index.set(file.subjectSession, files);
    }
    return indexes;
  }, [logFiles]);

  const handleViewLog = useCallback(
    async (subjectSession: string, module: SubjectModule) => {
      if (!projectRoot) return;
      setModalModule(module);
      setModalSubjectSession(subjectSession);
      setModalOpened(true);
      setModalLoading(true);
      setModalError(null);
      try {
        setModalContent(await fetchLogContent(projectRoot, subjectSession, module));
      } catch {
        setModalError("Failed to load log content");
        setModalContent(null);
      } finally {
        setModalLoading(false);
      }
    },
    [projectRoot],
  );

  const handleCloseModal = useCallback(() => {
    setModalOpened(false);
    setModalContent(null);
    setModalLoading(false);
    setModalError(null);
  }, []);

  const openReport = useCallback(
    (subjectSession: string, module: SubjectModule, runs: string[]) => {
      setReportModalSubjectSession(subjectSession);
      setReportModalModule(module);
      setReportModalRuns(runs);
      setReportModalOpened(true);
    },
    [],
  );

  const handleCloseReportModal = useCallback(() => {
    setReportModalOpened(false);
    setReportModalSubjectSession("");
    setReportModalRuns([]);
  }, []);

  return {
    structuralLogInfo,
    aslLogInfo,
    existingReports,
    handleViewLog,
    openReport,
    logModal: {
      opened: modalOpened,
      onClose: handleCloseModal,
      logContent: modalContent,
      module: modalModule,
      subjectSession: modalSubjectSession,
      loading: modalLoading,
      error: modalError,
    },
    reportModal: {
      opened: reportModalOpened,
      onClose: handleCloseReportModal,
      projectRoot,
      subjectSession: reportModalSubjectSession,
      module: reportModalModule,
      runs: reportModalRuns,
    },
  };
}
