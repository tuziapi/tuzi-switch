/* Copyright (C) 2025 QuantumNous. AGPL-3.0-or-later. */
import React from "react";
import { createRoot } from "react-dom/client";
import { TuziDownloadView } from "./TuziDownloadPage";
import { OpenTuPreviewPage } from "./OpenTuPreviewPage";
const preview = import.meta.env.VITE_DOWNLOAD_CHANNEL === "preview";
createRoot(document.getElementById("download-root")).render(
  preview ? <OpenTuPreviewPage /> : <TuziDownloadView standalone />,
);
