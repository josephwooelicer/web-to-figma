# Web2Figma

Web2Figma is a powerful toolkit designed to bridge the gap between web development and design. It allows you to capture any webpage's structure, styles, and layout directly from your browser and reconstruct it accurately as editable layers within Figma.

## Project Structure

- `chrome-extension/`: The browser extension used to analyze and capture the webpage DOM and CSS.
- `figma-plugin/`: The Figma plugin that receives the captured JSON and rebuilds the design.
- `shared/`: (Optional) Shared utilities or types used by both components.

## Prerequisites

- **Google Chrome** (or any Chromium-based browser).
- **Figma** (Desktop app or Web version).
- Modern system fonts (e.g., Inter, Roboto) for better accuracy during import.

---

## Installation Guide

### 1. Chrome Extension Setup
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `chrome-extension` folder from this repository.
5. The "Web2Figma Capture" icon should now appear in your extensions list.

### 2. Figma Plugin Setup
1. Open the Figma Desktop App.
2. Go to **Plugins > Development > New Plugin...**.
3. Click "Import plugin from manifest".
4. Select the `manifest.json` file located inside the `figma-plugin` folder.
5. The "Web2Figma" plugin is now ready to use.

---

## Usage Guide

### Step 1: Capture from Browser
1. Navigate to the webpage you want to capture.
2. Click the **Web2Figma Capture** extension icon.
3. Click the **Capture Page** button.
4. Wait for the status to show "Copied to clipboard!". The page structure is now stored in your clipboard as a JSON string.

### Step 2: Import to Figma
1. Open your Figma project.
2. Run the **Web2Figma** plugin (**Plugins > Development > Web2Figma**).
3. Paste the captured JSON string into the text area.
4. Click **Generate Design**.
5. The plugin will reconstruct the page. This may take a few seconds for complex pages.

---

## Technical Details

- **Style Mapping**: The tool captures computed styles (colors, fonts, borders, shadows, gradients) and maps them to Figma's internal data model.
- **Auto Layout Support**: Flexbox containers are automatically converted into Figma Auto Layout frames to preserve responsiveness.
- **SVG Capture**: SVGs are inlined with their computed styles for high-fidelity reproduction.
- **Rich Text**: Complex text nodes with multiple styles are captured as "Rich Text" layers.

## Troubleshooting

- **"Could not establish connection"**: Refresh the webpage and try capturing again.
- **Empty JSON**: Ensure the page has finished loading before clicking Capture.
- **Missing Fonts**: If a specific font isn't installed on your system, Figma will fallback to "Inter" or a default system font.
- **Complex Pages**: Extremely large pages might exceed clipboard limits or cause Figma to lag. Try capturing specific sections if needed.

## License

MIT
