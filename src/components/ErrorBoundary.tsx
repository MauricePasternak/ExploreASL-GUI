import { Alert, Button, Code, Group, Stack } from "@mantine/core";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { logAction } from "../lib/debug";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError() {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error, errorInfo);
    logAction("error_boundary_triggered", {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
    this.setState({ error, errorInfo });
  }

  private handleCopyReport = async () => {
    const { error, errorInfo } = this.state;
    const report = {
      timestamp: new Date().toISOString(),
      route: window.location.hash,
      userAgent: navigator.userAgent,
      error: {
        message: error?.message,
        stack: error?.stack,
      },
      componentStack: errorInfo?.componentStack,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: log to console
      console.error("Failed to copy error report to clipboard", report);
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <Stack gap="md" p="xl" style={{ maxWidth: 800, margin: "0 auto" }} data-testid="error-boundary">
          <Alert color="red" title="Something went wrong">
            An unexpected error occurred while rendering the application.
          </Alert>

          {this.state.error && (
            <Code block color="red">
              {this.state.error.message}
            </Code>
          )}

          {this.state.errorInfo && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Component stack</summary>
              <Code block mt="xs" style={{ whiteSpace: "pre-wrap" }}>
                {this.state.errorInfo.componentStack}
              </Code>
            </details>
          )}

          <Group>
            <Button onClick={this.handleCopyReport} variant="light" color="red" data-testid="error-copy-report-btn">
              {this.state.copied ? "Copied!" : "Copy error report"}
            </Button>
            <Button onClick={this.handleReload} variant="default" data-testid="error-reload-btn">
              Reload app
            </Button>
          </Group>
        </Stack>
      );
    }

    return this.props.children;
  }
}
