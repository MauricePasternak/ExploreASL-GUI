<div id="top"></div>

<div align="center">
  <img src="src-tauri/icons/easl_gui_logo.png" alt="ExploreASL GUI Logo" width="120" height="120" />

  <h1>ExploreASL GUI</h1>
  <p><strong>A modern, cross-platform desktop interface for Arterial Spin Labeling MRI analysis</strong></p>
  <p><em>From scanner to publication — powered by <a href="https://exploreasl.github.io/Documentation/latest/">ExploreASL</a></em></p>

  <br />

  <!-- Badges -->

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/MauricePasternak/ExploreASL-GUI?style=for-the-badge&label=Release&color=2d6a9f)](https://github.com/MauricePasternak/ExploreASL-GUI/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/MauricePasternak/ExploreASL-GUI/ci.yml?style=for-the-badge&label=CI&logo=github-actions&logoColor=white)](https://github.com/MauricePasternak/ExploreASL-GUI/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/MauricePasternak/ExploreASL-GUI/test.yml?style=for-the-badge&label=Tests&logo=vitest&logoColor=white)](https://github.com/MauricePasternak/ExploreASL-GUI/actions)
[![Issues](https://img.shields.io/github/issues/MauricePasternak/ExploreASL-GUI?style=for-the-badge&logo=github&color=e05d44)](https://github.com/MauricePasternak/ExploreASL-GUI/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br /><br />

<a href="https://github.com/MauricePasternak/ExploreASL-GUI/issues/new?labels=bug&template=bug_report.md">🐛 Report Bug</a>
·
<a href="https://github.com/MauricePasternak/ExploreASL-GUI/issues/new?labels=enhancement&template=feature_request.md">✨ Request Feature</a>
·
<a href="https://github.com/MauricePasternak/ExploreASL-GUI/releases">📦 Download</a>

</div>

---

> [!NOTE]
> This is a **complete rewrite** of the original [ExploreASL GUI (Electron)](https://github.com/MauricePasternak/ExploreASL-GUI/tree/electron-v1), rebuilt from the ground up using **Tauri v2**. It is lighter, faster, more secure, and ships native OS binaries instead of Electron's bundled Chromium runtime.

---

<details open>
<summary><strong>📋 Table of Contents</strong></summary>

1. [About The Project](#-about-the-project)
2. [Built With](#-built-with)
3. [Prerequisites](#-prerequisites)
4. [Installation](#-installation)
5. [Workflow](#-workflow)
6. [Developer Setup](#-developer-setup)
7. [Testing](#-testing)
8. [Roadmap](#-roadmap)
9. [Contributing](#-contributing)
10. [License](#-license)
11. [Acknowledgments](#-acknowledgments)

</details>

---

## 🧠 About The Project

**ExploreASL GUI** provides a friendly, modern desktop interface around the [ExploreASL](https://exploreasl.github.io/Documentation/latest/) MATLAB pipeline for processing Arterial Spin Labeling (ASL) MRI data. Whether you are a clinical researcher with dozens of subjects or a methods developer fine-tuning pipeline parameters, this GUI guides you through the entire analysis lifecycle without requiring you to write a single line of MATLAB.

### Key Capabilities

| Feature                        | Description                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 📂 **Dataset Import**          | Organize raw DICOM/NIfTI data into [BIDS](https://bids.neuroimaging.io/) format using a flexible source-data staging tree |
| 🔍 **Metadata Configuration**  | Define ASL sidecar JSON fields (labelling type, PLD, etc.) with per-scan override groups during import                    |
| ⚙️ **Parameter Configuration** | Configure ExploreASL processing parameters (`dataPar.json`) through structured forms with basic/advanced field toggles    |
| ▶️ **Pipeline Execution**      | Select subjects and modules (Structural / ASL / Population) with real-time progress tracking via `.status` lock files     |
| 📊 **Results Visualization**   | Explore population statistics via scatter/swarm plots and inspect subject-level qCBF NIfTI volumes interactively          |
| 🔄 **Selective Re-run**        | Re-process specific subjects or modules; stale locks, status files, and logs are cleaned automatically before each run    |

---

## 🛠 Built With

| Layer                 | Technology                                                                        |
| --------------------- | --------------------------------------------------------------------------------- |
| **Desktop shell**     | [Tauri v2](https://v2.tauri.app/) (Rust backend, WebView2 / WebKit frontend)      |
| **UI Framework**      | [React 19](https://react.dev/) + [TypeScript 6](https://www.typescriptlang.org/)  |
| **Component Library** | [Mantine 9](https://mantine.dev/)                                                 |
| **State Management**  | [Zustand 5](https://zustand-demo.pmnd.rs/)                                        |
| **Schema Validation** | [Zod 4](https://zod.dev/)                                                         |
| **Routing**           | [React Router 7](https://reactrouter.com/)                                        |
| **Forms**             | [React Hook Form 7](https://react-hook-form.com/)                                 |
| **Build Tool**        | [Vite 8](https://vitejs.dev/)                                                     |
| **Testing**           | [Vitest 4](https://vitest.dev/) + [Testing Library](https://testing-library.com/) |

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 📋 Prerequisites

Before running ExploreASL GUI you will need two dependencies installed separately:

| Dependency     | Version                                             | Link                                                                         |
| -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| **MATLAB**     | R2019a or later                                     | [mathworks.com/downloads](https://www.mathworks.com/downloads/)              |
| **ExploreASL** | v11.1.0 or later (v2+ / `develop` branch preferred) | [github.com/ExploreASL/ExploreASL](https://github.com/ExploreASL/ExploreASL) |

> [!NOTE]
> Future releases will also support **MATLAB Runtime** with a pre-compiled ExploreASL package and an **ExploreASL Docker image** ([hub.docker.com/r/exploreasl/xasl](https://hub.docker.com/r/exploreasl/xasl)). These are not yet available in the current version.

### Platform Dependencies (for running from source only)

| Dependency                                                        | Notes                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| [Rust toolchain](https://rustup.rs/)                              | Stable channel, ≥ 1.77                                         |
| [Node.js](https://nodejs.org/)                                    | ≥ 20 LTS                                                       |
| [pnpm](https://pnpm.io/)                                          | ≥ 9                                                            |
| [Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/) | Platform-specific (WebView2 on Windows, WebKit on Linux/macOS) |

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 📦 Installation

### Download a Pre-built Release _(recommended for end users)_

Head to the [**Releases**](https://github.com/MauricePasternak/ExploreASL-GUI/releases) page and download the installer for your operating system.

#### 🪟 Windows

Double-click the `.msi` installer. The app will be installed silently and a Start Menu shortcut will be created.

#### 🐧 Linux

```bash
sudo apt install ./exploreasl-gui_<version>_amd64.deb
```

After installation, type `exploreasl` in your application launcher.

#### 🍎 macOS

Open the `.dmg` and drag the application bundle to your Applications folder.

> [!WARNING]
> The application is currently unsigned. On first launch macOS will display an "unidentified developer" warning. Go to **System Settings → Privacy & Security** and click **"Open Anyway"** to authorize the app.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 🔧 Setting Up MATLAB & ExploreASL

The GUI requires both MATLAB and ExploreASL to be installed on your machine before it can process data. Follow the steps below for your operating system.

> [!TIP]
> The ExploreASL team maintains a detailed installation tutorial with screenshots: [exploreasl.github.io/Documentation/latest/Tutorials-Install](https://exploreasl.github.io/Documentation/latest/Tutorials-Install/)

### Step 1 — Install MATLAB

1. Go to [mathworks.com/downloads](https://www.mathworks.com/downloads/) and sign in with your MathWorks account. If you do not have one, your institution may provide a campus license — check with your IT or licensing department.
2. Download the MATLAB installer for your operating system (Windows, macOS, or Linux).
3. Run the installer. When prompted, select **R2019a or later** (R2023b or newer recommended). You do not need any additional toolboxes for ExploreASL.
4. Complete the installation and launch MATLAB once to confirm it opens without errors.

> [!TIP]
> Already have MATLAB installed? You can check your version by opening MATLAB and typing `version` in the command window. Any version from R2019a onward will work.

### Step 2 — Install ExploreASL from GitHub

ExploreASL is a free, open-source MATLAB toolbox. You obtain it by downloading or cloning it from GitHub.

#### Option A — Download the ZIP (no Git required)

1. Go to [github.com/ExploreASL/ExploreASL](https://github.com/ExploreASL/ExploreASL).
2. Near the top of the page, you will see a dropdown button that says **main**. Click it and select **develop** — this is the recommended version.
3. Click the green **<> Code** button, then select **Download ZIP**.
4. Extract the ZIP file:
   - **Windows:** Right-click the downloaded `.zip` file and select **Extract All…**, then click **Extract**. Move the extracted folder to a location like `C:\ExploreASL`.
   - **macOS:** Double-click the `.zip` file (Safari extracts it automatically). Move the resulting folder to a location like your home folder (the folder with your username).
   - **Linux:** Right-click the `.zip` file and select **Extract Here**, or run `unzip ExploreASL-develop.zip` in a terminal. Move the folder to a location like `/home/your-username/ExploreASL`.

> [!WARNING]
> Do not place ExploreASL inside a cloud-synced folder (OneDrive, Dropbox, Google Drive, iCloud). Cloud sync can corrupt files during processing. If your Desktop or Documents folder is synced to the cloud, choose a different location such as `C:\ExploreASL` on Windows.

> [!IMPORTANT]
> Once you have configured the GUI to use this folder, do not move or rename it. The GUI remembers the path and will need to be updated if the folder is relocated.

#### Option B — Clone with Git

If you are comfortable with the command line:

```bash
git clone --branch develop https://github.com/ExploreASL/ExploreASL.git
```

This clones the latest `develop` branch (v2+), which is the recommended version.

### Step 3 — Tell the GUI Where ExploreASL Is

When you first launch ExploreASL GUI, it will ask you to locate your ExploreASL installation folder. Navigate to the folder you extracted or cloned in Step 2 — it should be named `ExploreASL` (or `ExploreASL-develop`) and contain a file called `ExploreASL.m` inside it.

You can change this path at any time from the GUI's settings.

> [!NOTE]
> If you are in a hospital or institutional environment, your IT department may restrict running unsigned software or limit MATLAB network licensing. Contact your IT support if you encounter permission or licensing errors.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 🔄 Workflow

ExploreASL GUI follows a three-phase analysis pipeline:

```
Raw DICOM / NIfTI
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  Import Module                                          │
│  Ingest → Tokenize → Resolve Aliases → Metadata → Run   │
│  Stage source data into BIDS with configured sidecars   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Parameters Module                                      │
│  Configure dataPar.json (Structural, ASL, Population)   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Processing Module                                      │
│  Select subjects → Run modules → Monitor progress       │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Visualization Module                                   │
│  Scatter/swarm plots of ROI stats + NIfTI volume viewer │
└─────────────────────────────────────────────────────────┘
```

### Import Dataset

The import module walks you through five sub-steps:

1. **Ingest DICOMs** — Select your source directory and scan for DICOM files, with optional subfolder grouping
2. **Tokenize Paths** — Map folder hierarchy levels to BIDS identifiers (Subject / Session / Run / Modality)
3. **Resolve Aliases** — Rename subjects, order sessions/runs, and map raw scan labels to BIDS modality types
4. **Acquisition Metadata** — Configure ASL-specific parameters (labelling type, PLD, labelling duration) with per-scan overrides
5. **Preview & Run** — Review the staging layout and `dataPar.json`, then execute the import via dcm2niix

### Configure Global Project Data Parameters

Configure the ExploreASL `dataPar.json` through structured forms covering Structural, ASL, Population, and Atlas settings. Basic fields are shown by default; advanced fields are revealed per section.

### Processing Pipeline Execution

Select the subjects and pipeline modules (Structural / ASL / Population) you want to process. The GUI spawns MATLAB worker processes and tracks progress via ExploreASL's `.status` lock files, showing per-subject step completion in real time.

### Visualize Results

Load population-level statistics TSV files and explore data via scatter and swarm plots. Click any data point to load the corresponding subject's qCBF NIfTI volume in an interactive 3D viewer.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 💻 Developer Setup

```bash
# 1. Clone the repository
git clone https://github.com/MauricePasternak/ExploreASL-GUI.git
cd ExploreASL-GUI

# 2. Install JavaScript dependencies
pnpm install

# 3. Start the development server (hot-reload, browser preview at http://localhost:1420)
pnpm dev

# 4. Start the full Tauri development app (requires a desktop environment)
pnpm tauri dev
```

> [!TIP]
> Most frontend work can be done at `http://localhost:1420` with `pnpm dev`. Tauri APIs (filesystem, dialogs, subprocess) are mocked during browser development — start `pnpm tauri dev` only when you need to test native functionality.

### Project Structure

```
ExploreASL_GUI/
├── src/                    # React frontend (TypeScript)
│   ├── components/         # Reusable UI components
│   ├── pages/              # Route-level page components
│   ├── stores/             # Zustand state stores
│   ├── lib/                # Utilities, schemas, debug tools
│   └── test/               # Test setup & mocks
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/                # Rust source files
│   └── icons/              # Application icons
├── openspec/               # Feature specs (authoritative)
│   ├── specs/              # Canonical specifications
│   └── changes/            # In-progress change documents
├── e2e-tests/              # End-to-end tests (WebdriverIO + tauri-driver)
└── test/                   # Test data & datasets
```

### Project State

- **Project file:** `<root>/project.easl` — JSON file storing the current project state
- **Global settings:** Stored via `@tauri-apps/plugin-store` (`settings.json`) in the OS app data directory
- **Dev logs:** `<OS temp dir>/opencode/exploreasl-gui-logs/dev.log` (uses `std::env::temp_dir()`, e.g. `/tmp` on Linux, `%TEMP%` on Windows)

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 🧪 Testing

```bash
# Run unit tests (Vitest)
pnpm test

# Run unit tests in watch mode
pnpm test:watch

# Run end-to-end tests (requires a debug build at src-tauri/target/debug/exploreasl_gui)
pnpm test:e2e
```

Unit tests cover schemas, Zustand stores, and utility functions. Component tests cover critical UI paths. E2E tests drive the native Tauri window via `tauri-driver` + WebdriverIO.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 🗺 Roadmap

- [x] Core project scaffolding (Tauri v2 + React + Mantine)
- [x] Dataset import with BIDS staging tree
- [x] ASL metadata configuration with per-scan overrides
- [x] Processing parameter configuration (`dataPar.json`)
- [x] Pipeline execution with real-time progress tracking
- [x] Results visualization (population stats + NIfTI viewer)
- [ ] Auto-update support
- [ ] Documentation site

See [open issues](https://github.com/MauricePasternak/ExploreASL-GUI/issues) for a full list of planned features and known bugs.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes using [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add CBF viewer`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please read the [AGENTS.md](AGENTS.md) file for coding conventions, testing requirements, and agent guidelines before contributing.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 🙏 Acknowledgments

### ExploreASL Team

This GUI is built around [ExploreASL](https://exploreasl.github.io/Documentation/latest/), an open-source MATLAB/SPM-based pipeline for ASL MRI data analysis, developed and maintained by the ExploreASL community. Please cite the ExploreASL paper if you use this software in your research:

> Mutsaerts, H.J.M.M., et al. (2021). _ExploreASL: An image processing pipeline for multi-center ASL perfusion MRI studies._ NeuroImage, 225, 117549. https://doi.org/10.1016/j.neuroimage.2020.117549

### Previous Version

The original Electron-based ExploreASL GUI is preserved at [MauricePasternak/ExploreASL-GUI (electron-v1 branch)](https://github.com/MauricePasternak/ExploreASL-GUI/tree/electron-v1). This Tauri v2 rewrite supersedes it with a significantly smaller binary footprint, improved security, and a modernized tech stack.

### Built With Open Source

- [Tauri](https://v2.tauri.app/) — Cross-platform desktop framework
- [Mantine](https://mantine.dev/) — React component library
- [ExploreASL](https://github.com/ExploreASL/ExploreASL) — The underlying pipeline

<p align="right">(<a href="#top">back to top</a>)</p>
