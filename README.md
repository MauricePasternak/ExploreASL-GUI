<div id="top"></div>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/othneildrew/Best-README-Template">
    <img src="./src/assets/appIcons/ExploreASLGUIIcon.png" fill="red" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">ExploreASLJS</h3>

  <p align="center">
    Scanner To Publication User Interface for ASL Imaging
    <br />
    <br />
    <a href="https://github.com/MauricePasternak/ExploreASLJS/issues">Report Bug</a>
    ·
    <a href="https://github.com/MauricePasternak/ExploreASLJS">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details open>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#installation-instructions-for-developers">Installation for Developers</a></li>
        <li><a href="#general-project-structure">General Structure</a></li>
        <li><a href="#installation-instructions-for-users">Installation for Users</a></li>
        <li><a href="#uninstallation-instructions-for-users">Uninstallation for Users</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li>
        <a href="#acknowledgments">Acknowledgments</a>
        <ul>
            <li><a href="#support">Support</a></li>
            <li><a href="#exploreasl-team">ExploreASL Team</a></li>
        </ul>
    </li>
  </ol>
</details>

---

## <!-- ABOUT THE PROJECT -->

## About The Project

This project wraps around [ExploreASL](https://exploreasl.github.io/Documentation/1.10.0beta/) to provide users with a friendly and modern interface for analyzing their arterial spin labeling datasets, including:

- Importing their ASL datasets into BIDS standard
- Defining and re-using data parameters across studies for easier troubleshooting
- Running ExploreASL's modules in a parallel manner using multiprocessing to split the workload within and between studies

<p align="right">(<a href="#top">back to top</a>)</p>

### Built With

<br/>

- [![Electron][electronjs]][electron-url]
- [![React][react.js]][react-url]
- [![MaterialUI][mui.js]][mui-url]

<p align="right">(<a href="#top">back to top</a>)</p>

---

<!-- GETTING STARTED -->

## Getting Started

### Installation Instructions For Developers

It is assumed that developers wishing to engage with this project will already have NodeJS installed on their system and
that they are using `yarn` as their package manager.

[Click here](https://nodejs.org/en/) for more information on NodeJS installation.

[Click here](https://classic.yarnpkg.com/en/docs/getting-started) for more information on yarn installation.

1. Clone the repo
   ```sh
   git clone https://github.com/MauricePasternak/ExploreASLJS.git
   ```
2. Install Javascript packages contained within `package.json`
   ```sh
   yarn install
   ```
3. Start up the GUI with hot-reload and have a crack at it
   ```sh
   yarn start
   ```

### General Project Structure

```
/---|
    |-> assets (media such as icons)
    |-> backend (logic executed by electron's IpcMain, i.e. spawning subprocesses to run ExploreASL)
    |-> common -|
    |           |-> schemas (form validators & form schemas)
    |           |-> types (reusable types & typescript declarations)
    |           |-> utilityFunctions (reusable functions for reducing code use)
    |           |-> GLOBALS.ts (global variables used throughout)
    |
    |-> communications (logic for type-safe IpcMain <-> IpcRenderer communication)
    |-> components (reuseable React components)
    |-> pages (non-reuseable React components that make up the pages of the GUI)
    |-> stores (frontend-only collections of user-interface state)
    ... other files relate to project setup, package-handling, etc.
```

### Installation Instructions For Users

Head on over to the [Releases](https://github.com/MauricePasternak/ExploreASLJS/releases) and download the appropriate version for your operating system

### Uninstallation Instructions For Users

#### For Windows

In your search bar, look for "Add or remove programs". Select the application and click uninstall.

#### For Linux

Open a terminal and type in:

```bash
sudo apt remove exploreasljs
```

#### For MacOS

Go to the Applications folder and drag & drop the ExploreASLJS.app application to the Trash bin.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## <!-- USAGE EXAMPLES -->

## Usage

### Import Your Dataset

<img src="./src/assets/img/READMEImages/ImportModule.png" style="width: max(400px, 50%)" />
<br />
<br />

### Define Processing Parameters

<img src="./src/assets/img/READMEImages/DefineDataParametersModule.png" style="width: max(400px, 50%)"  />
<br />
<br />

### Run ExploreASL

<img src="./src/assets/img/READMEImages/RunExploreASLModule.png" style="width: max(400px, 50%)"  />

### Visualize Your Dataset

<img src="./src/assets/img/READMEImages/DataVisualizationModule.png" style="width: max(700px, 60%)" />

<p align="right">(<a href="#top">back to top</a>)</p>

---

## <!-- ROADMAP -->

## Roadmap

- [x] Add Dark Mode.
- [x] Add Image Feedback during processing.
- [x] Support multiple ASL Import contexts. \*
- [x] Create a Data Visualization Module.
- [ ] Add help information on the steps within the Data Visualization Module.
- [ ] Add plot settings for plot legends (i.e. legend text fontsize, positioning, etc.) within the DataVisualization Module.
- [ ] Add plot settings for renaming axis main labels within the Data Visualization Module.
- [ ] Add Multiprocessing Capability to the Import Module as well. \*\*
- [ ] Add a submodule to Process Studies where users can pin-point change the JSON sidecars of individual subjects/visits/sessions.
- [ ] Add auto-update capability to the software so that users don't have to manually install new versions.

\* This is only partially the case. The GUI goes through extensive logical gymnastics to get ExploreASL to import different subsets of your dataset. The official ExploreASL application does not support this as of version 1.10.0.

\*\* This will probably have to wait until the main ExploreASL program can handle multiple contexts.

See the [open issues](https://github.com/othneildrew/Best-README-Template/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#top">back to top</a>)</p>

---

## <!-- CONTRIBUTING -->

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#top">back to top</a>)</p>

---

## <!-- LICENSE -->

## License

Distributed under the MIT License. See `LICENSE` for more information.

<p align="right">(<a href="#top">back to top</a>)</p>

---

## <!-- CONTACT -->

## Contact

Maurice Pasternak - maurice.pasternak@utoronto.ca

Project Link: [https://github.com/MauricePasternak/ExploreASLJS](https://github.com/MauricePasternak/ExploreASLJS)

<p align="right">(<a href="#top">back to top</a>)</p>

---

## <!-- ACKNOWLEDGMENTS -->

## Acknowledgments

### Support

For GUI-related questions, please don't hesitate to drop an email at: maurice.pasternak@utoronto.ca

For more information on the main program, click on the following: [CLICK ME!](https://sites.google.com/view/exploreasl)

### ExploreASL Team

For questions or concerns with the underlying ExploreASL program, the following individuals compromise the development team and may be contacted:

- Henk-Jan Mutsaerts; HenkJanMutsaerts@Gmail.com (ExploreASL creator)
- Jan Petr; j.petr@hzdr.de (ExploreASL creator)
- Michael Stritt; stritt.michael@gmail.com
- Paul Groot; p.f.c.groot@amsterdamumc.nl
- Pieter Vandemaele; pieter.vandemaele@gmail.com
- Maurice Pasternak; maurice.pasternak@utoronto.ca
- Luigi Lorenzini; l.lorenzini@amsterdamumc.nl
- Sandeep Ganji; Sandeep.g.bio@gmail.com

<p align="right">(<a href="#top">back to top</a>)</p>

---

<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->

[contributors-shield]: https://img.shields.io/github/contributors/MauricePasternak/ExploreASLJS.svg?style=for-the-badge
[contributors-url]: https://github.com/MauricePasternak/ExploreASLJS/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/MauricePasternak/ExploreASLJS.svg?style=for-the-badge
[forks-url]: https://github.com/MauricePasternak/ExploreASLJS/network/members
[stars-shield]: https://img.shields.io/github/stars/MauricePasternak/ExploreASLJS.svg?style=for-the-badge
[stars-url]: https://github.com/MauricePasternak/ExploreASLJS/stargazers
[issues-shield]: https://img.shields.io/github/issues/MauricePasternak/ExploreASLJS.svg?style=for-the-badge
[issues-url]: https://github.com/MauricePasternak/ExploreASLJS/issues
[license-shield]: https://img.shields.io/github/license/MauricePasternak/ExploreASLJS.svg?style=for-the-badge
[license-url]: https://github.com/MauricePasternak/ExploreASLJS/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://www.linkedin.com/in/maurice-pasternak-238957207/

<!-- Badges -->

[react.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[react-url]: https://reactjs.org/
[electron-url]: https://www.electronjs.org
[electronjs]: https://img.shields.io/badge/Electron-2b2e3a?style=for-the-badge&logo=electron&logoColor=white
[mui.js]: https://img.shields.io/badge/Material%20UI%20V5-0074e9?style=for-the-badge&logo=mui&logoColor=white
[mui-url]: https://mui.com/
