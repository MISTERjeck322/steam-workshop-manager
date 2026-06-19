# Steam Workshop Pirate / Manager

A handy tool for manually downloading, installing, and tracking updates of mods from the Steam Workshop directly through your browser. 

The project consists of two parts:
1. **A local Python server** (FastAPI) that manages downloads via the official SteamCMD command-line utility.
2. **A browser extension** that adds control elements to Steam web pages.

---

## Why is this application needed?

*   **Control over mod versions**: In the official Steam client, mods are updated automatically, which often breaks compatibility in saved games or disrupts large modpacks. This manager allows you to store mods locally and update them only when you decide to.
*   **Offline gaming**: The tool helps prepare mod setups for playing offline, for unofficial versions of games, and simplifies installing mods on dedicated servers.
*   **An alternative to questionable web services**: You no longer need to use third-party downloader sites that often limit download speeds, contain excessive ads, or provide outdated files. Downloads are performed directly from Steam servers at your internet connection's maximum speed.

---

## Key Features

*   **Steam interface integration**: The extension embeds a "Download" button directly onto Workshop pages in the browser. It supports downloading both individual mods and entire collections with a single click.
*   **Convenient sidebar**: A built-in download manager is available inside the browser, displaying the download queue, current progress, and a list of already added mods.
*   **Automatic distribution to folders**: You can specify the path to the mod folder for each game once, and the manager will unpack and distribute the downloaded files to the appropriate directories.
*   **Verification and manual updates**: The scan function compares the modification dates of local files with the latest versions from the Steam API. If a mod has been updated, the manager will offer to download the new version.
*   **Import and export of collections**: You can export your mod list to a JSON file for backup or to share it with a friend, allowing them to download the entire build with a single button.
*   **Multi-language support**: The interface is translated into English, Russian, Ukrainian, Spanish, Portuguese, and Indonesian.

---

## Testing and Compatibility

Development and basic testing were conducted in the following environment:
*   **Operating System**: Windows 10
*   **Browser**: Google Chrome

*Note: The server-side component contains Windows-specific calls (running `steamcmd.exe`, hiding system console windows), so running it on other platforms (Linux/macOS) in the current version may require manual adaptation of the source code.*

---

## User Instructions (Quick Start)

### Step 1. Preparing Folders
1. Go to the **[Releases](https://github.com/MISTERjeck322/Steam-Workshop-Pirate/releases)** section (on the right side of this page) and download the archive with the latest version of the application.
2. Extract the downloaded archive to any convenient location on your computer.
3. Place the `steamcmd.exe` utility (which can be downloaded from the [official Valve website](https://developer.valvesoftware.com/wiki/SteamCMD#Downloading_SteamCMD)) into the `steamCMD` folder inside the extracted archive.

### Step 2. Starting the Server
1. Run the `WorkshopManagerServer.exe` file from the extracted archive.
2. Do not close the application window while using the downloader.

### Step 3. Installing the Extension in the Browser
1. Open your browser (Google Chrome, Yandex Browser, Opera, Edge, or another Chromium-based browser) and navigate to the extensions page (type `chrome://extensions/` into the address bar or find it in the browser menu).
2. In the top-right corner, enable the **"Developer mode"** toggle.
3. Click the **"Load unpacked"** button that appears on the left.
4. In the file explorer that opens, select the `SteamPirateExtension` folder located inside the extracted archive.

*Done! Download buttons will now appear on Steam Workshop mod pages.*

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/misterjeck)
---

## 🛠 Developer Instructions (Running from Source Code)

<details>
<summary>Expand instructions for building and running the code</summary>

If you want to run the project directly from the source code or make changes to it, use these instructions.

### Requirements
* Python 3.9+
* Installed package manager `pip`

#### Step 1. Cloning and Installing Dependencies
1. Clone the repository to your local machine:
   ```bash
   git clone https://github.com/MISTERjeck322/Steam-Workshop-Pirate.git
   ```
2. Navigate to the project folder and install the libraries:
   ```bash
   cd Steam-Workshop-Pirate
   pip install -r requirements.txt
   ```

### Step 2. Running the Server from the Console
Run the server script:
```bash
python main.py
```

### Step 3. Building the Executable (.exe)
If you want to build a standalone `.exe` file without a console window yourself:
```bash
pip install pyinstaller
pyinstaller --onefile --noconsole --name="WorkshopManagerServer" main.py
```
The compiled file will appear in the newly created `dist` folder.

</details>

---

## License
This project is distributed under the GNU GPL v3 license.
