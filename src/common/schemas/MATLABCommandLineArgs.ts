export type MATLABArgsPlatformType = {
  [key in Extract<NodeJS.Platform, "win32" | "darwin" | "linux">]: string[];
};

export const MATLABCommandLineArgsPost2019: MATLABArgsPlatformType = {
  linux: ["-nodesktop", "-nosplash", "-nodisplay", "-batch"],
  darwin: ["-nodesktop", "-nosplash", "-nodisplay", "-batch"],
  win32: ["-nosplash", "-batch"],
};

export const MATLABCommandLineArgsPre2019: MATLABArgsPlatformType = {
  linux: ["-nodesktop", "-nosplash", "-nodisplay", "-r"],
  darwin: ["-nodesktop", "-nosplash", "-nodisplay", "-r"],
  win32: ["-nosplash", "-r"],
};
