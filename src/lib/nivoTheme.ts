/**
 * Build a nivo theme object adapted to the active Mantine color scheme.
 */

interface NivoPartialTheme {
  axis: {
    ticks: {
      text: { fill: string };
      line: { stroke: string };
    };
    domain: {
      line: { stroke: string };
    };
  };
  grid: {
    line: { stroke: string };
  };
  legends: {
    text: { fill: string };
  };
}

export function buildNivoTheme(colorScheme: string): NivoPartialTheme {
  const isDark = colorScheme === "dark";

  return {
    axis: {
      ticks: {
        text: {
          fill: isDark ? "#C1C2C5" : "#333",
        },
        line: {
          stroke: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",
        },
      },
      domain: {
        line: {
          stroke: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)",
        },
      },
    },
    grid: {
      line: {
        stroke: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      },
    },
    legends: {
      text: {
        fill: isDark ? "#C1C2C5" : "#333",
      },
    },
  };
}
