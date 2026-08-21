import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { App } from "./App.jsx";
import { loadArchive } from "./edition-loader.js";
import { createFeedbackService } from "./feedback-service.js";
import { createReportCompanionClient } from "./report-companion-client.js";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
const feedbackService = createFeedbackService({ apiBase: import.meta.env.VITE_FEEDBACK_API_BASE });
const reportService = createReportCompanionClient({ baseUrl: import.meta.env.VITE_REPORT_COMPANION_BASE });
const reportAppOrigin = import.meta.env.VITE_REPORT_APP_ORIGIN || "https://today-i-found.pages.dev";
const render = (props) => root.render(<React.StrictMode><App {...props} feedbackService={feedbackService} reportService={reportService} reportAppOrigin={reportAppOrigin} /></React.StrictMode>);

render({ edition: null });
loadArchive({ baseUrl: import.meta.env.BASE_URL }).then(({ manifest, edition, loadEdition }) => {
  render({ edition, manifest, loadEdition });
}).catch((error) => {
  render({ edition: error });
});
