import { createHashRouter } from "react-router";

import App, { type AppProps } from "../App";

export function createAppRouter(options?: AppProps) {
  return createHashRouter([{ path: "*", element: <App {...options} /> }]);
}
