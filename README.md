<div id="top"></div>

<div align="center">
  <img src="src-tauri/icons/easl_gui_logo.png" alt="ExploreASL GUI Logo" width="120" height="120" />

  <h1>ExploreASL GUI</h1>
  <p><strong>A modern, cross-platform desktop interface for Arterial Spin Labeling MRI analysis</strong></p>
  <p><em>From scanner to publication — powered by <a href="https://exploreasl.github.io/Documentation/latest/">ExploreASL</a></em></p>

  <br />

  <!-- Badges -->

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/MauricePasternak/ExploreASL-GUI-v2?style=for-the-badge&label=Release&color=2d6a9f)](https://github.com/MauricePasternak/ExploreASL-GUI-v2/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/MauricePasternak/ExploreASL-GUI-v2/ci.yml?style=for-the-badge&label=CI&logo=github-actions&logoColor=white)](https://github.com/MauricePasternak/ExploreASL-GUI-v2/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/MauricePasternak/ExploreASL-GUI-v2/test.yml?style=for-the-badge&label=Tests&logo=vitest&logoColor=white)](https://github.com/MauricePasternak/ExploreASL-GUI-v2/actions)
[![Issues](https://img.shields.io/github/issues/MauricePasternak/ExploreASL-GUI-v2?style=for-the-badge&logo=github&color=e05d44)](https://github.com/MauricePasternak/ExploreASL-GUI-v2/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br /><br />

<a href="https://github.com/MauricePasternak/ExploreASL-GUI-v2/issues/new?labels=bug&template=bug_report.md">🐛 Report Bug</a>
·
<a href="https://github.com/MauricePasternak/ExploreASL-GUI-v2/issues/new?labels=enhancement&template=feature_request.md">✨ Request Feature</a>
·
<a href="https://github.com/MauricePasternak/ExploreASL-GUI-v2/releases">📦 Download</a>

</div>

---

> [!NOTE]
> This is a **complete rewrite** of the original [ExploreASL GUI (Electron)](https://github.com/MauricePasternak/ExploreASL-GUI), rebuilt from the ground up using **Tauri v2**. It is lighter, faster, more secure, and ships native OS binaries instead of Electron's bundled Chromium runtime.

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
| 🔍 **BIDS Verification**       | Inspect and correct ASL sidecar JSON fields at the individual scan level                                                  |
| ⚙️ **Parameter Configuration** | Define and reuse ExploreASL processing parameters (`dataPar.json`) across studies                                         |
| ▶️ **Pipeline Execution**      | Launch Structural, ASL, and Population modules in parallel with real-time progress tracking                               |
| 📊 **Results Visualization**   | Explore CBF (cerebral blood flow) maps and QC plots interactively                                                         |
| 🔄 **Re-run & Clean**          | Selectively re-process subjects or fully clean corrupted outputs without touching the rest of the study                   |

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

Before running ExploreASL GUI you will need:

### ExploreASL (required)

Choose **one** of the following:

- **Full MATLAB installation** (R2019a or later) **+** [ExploreASL source code](https://github.com/ExploreASL/ExploreASL) cloned from GitHub — _recommended for most users_
- **MATLAB Runtime R2019a (9.6)** + a pre-compiled ExploreASL binary — _contact the [ExploreASL team](https://sites.google.com/view/exploreasl/contact) for compiled builds_

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

Head to the [**Releases**](https://github.com/MauricePasternak/ExploreASL-GUI-v2/releases) page and download the installer for your operating system.

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

## 🔄 Workflow

ExploreASL GUI follows a five-step analysis pipeline:

```
Raw DICOM / NIfTI
        │
        ▼
┌─────────────────┐
│  1. Import      │  Stage source data → BIDS
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  2. Verify BIDS │  Inspect & correct ASL sidecar JSON fields
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. Parameters  │  Configure ExploreASL processing settings (dataPar.json)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. Run         │  Launch pipeline modules; monitor real-time progress
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. Visualize   │  Explore CBF maps and QC plots interactively
└─────────────────┘
```

### 1) Import Your Dataset

Drag-and-drop source files into the staging tree, define the `[Subject / Session / Run / Modality]` folder token ordering, and let the GUI produce a BIDS-compliant `sourcedata/` directory along with an `studyPar.json` sidecar for sequence parameters.

### 2) Verify BIDS

Review the generated ASL JSON sidecars at the scan level. Fields that are missing, incorrect, or need per-scan overrides can be edited directly within the interface.

### 3) Define Processing Parameters

Configure the ExploreASL `dataPar.json` through a structured form covering M0, quantification, ASL processing, atlases, and more. Basic fields are shown by default; advanced fields are revealed per section. Settings are saved in the project file (`.easl`) and merged at processing time.

### 4) Run ExploreASL

Select the subjects and pipeline modules (Structural / ASL / Population) you want to process. The GUI spawns parallel worker processes and tracks progress via ExploreASL's `.status` lock files, showing per-subject step completion in real time.

### 5) Visualize Results

Load the processed dataset and explore cerebral blood flow (CBF) maps alongside population-level statistics and QC plots.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## 💻 Developer Setup

```bash
# 1. Clone the repository
git clone https://github.com/MauricePasternak/ExploreASL-GUI-v2.git
cd ExploreASL-GUI-v2

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
- **Dev logs:** `/tmp/opencode/exploreasl-gui-logs/dev.log`

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
- [x] BIDS sidecar verification
- [x] Processing parameter configuration (`dataPar.json`)
- [x] Pipeline execution with real-time progress tracking
- [ ] Results visualization (CBF maps & QC plots)
- [ ] Signed macOS & Windows releases
- [ ] Auto-update support
- [ ] Documentation site

See [open issues](https://github.com/MauricePasternak/ExploreASL-GUI-v2/issues) for a full list of planned features and known bugs.

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

The original Electron-based ExploreASL GUI can be found at [MauricePasternak/ExploreASL-GUI](https://github.com/MauricePasternak/ExploreASL-GUI). This Tauri v2 rewrite supersedes it with a significantly smaller binary footprint, improved security, and a modernized tech stack.

### Built With Open Source

- [Tauri](https://v2.tauri.app/) — Cross-platform desktop framework
- [Mantine](https://mantine.dev/) — React component library
- [ExploreASL](https://github.com/ExploreASL/ExploreASL) — The underlying pipeline

<p align="right">(<a href="#top">back to top</a>)</p>
