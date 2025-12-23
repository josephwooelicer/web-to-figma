figma.showUI(__html__, { width: 300, height: 400 });

function normalizeLink(link) {
    if (!link) return null;
    if (link.type === 'URL' && link.value) return link;
    if (link.url) return { type: 'URL', value: link.url };
    return null;
}

async function safeLoadFont(fontName) {
    try {
        await figma.loadFontAsync(fontName);
        return fontName;
    } catch (e) {
        // Fallback 1: Try family + Regular
        if (fontName.style !== "Regular") {
            try {
                const fallback = { family: fontName.family, style: "Regular" };
                await figma.loadFontAsync(fallback);
                return fallback;
            } catch (e2) { }
        }
        // Fallback 2: Inter Regular
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        return { family: "Inter", style: "Regular" };
    }
}

async function createLayer(data, parent, parentGlobalX = 0, parentGlobalY = 0) {
    let layer;

    if (data.type === 'TEXT') {
        const family = data.fontFamily || "Inter";
        let style = "Regular";
        const isBold = data.fontWeight && data.fontWeight.toString().includes('bold');
        const isItalic = data.fontStyle === 'italic';

        if (isBold && isItalic) style = "Bold Italic";
        else if (isBold) style = "Bold";
        else if (isItalic) style = "Italic";

        const loadedFont = await safeLoadFont({ family, style });
        layer = figma.createText();
        layer.fontName = loadedFont;

        if (data.textIndent) {
            layer.paragraphIndent = data.textIndent;
        }

        layer.characters = data.characters || "";

        if (data.styleRanges && data.styleRanges.length > 0) {
            // Pre-load all fonts needed for ranges
            const fonts = new Set();
            for (const range of data.styleRanges) {
                const rIsBold = range.fontWeight === 'bold';
                const rIsItalic = range.fontStyle === 'italic';
                let rStyle = "Regular";
                if (rIsBold && rIsItalic) rStyle = "Bold Italic";
                else if (rIsBold) rStyle = "Bold";
                else if (rIsItalic) rStyle = "Italic";

                const fontToLoad = { family: range.fontFamily || "Inter", style: rStyle };
                const loaded = await safeLoadFont(fontToLoad);
                range.actualFontName = loaded; // Store the successfully loaded font
            }

            // Apply ranges
            for (const range of data.styleRanges) {
                const start = range.start;
                const end = Math.min(range.end, layer.characters.length);
                if (start >= end) continue;

                if (range.fontSize) layer.setRangeFontSize(start, end, range.fontSize);

                if (range.actualFontName) {
                    layer.setRangeFontName(start, end, range.actualFontName);
                }

                if (range.fill) layer.setRangeFills(start, end, [range.fill]);
                if (range.textCase) layer.setRangeTextCase(start, end, range.textCase);
                if (range.textDecoration) layer.setRangeTextDecoration(start, end, range.textDecoration);
                if (range.lineHeight) {
                    layer.setRangeLineHeight(start, end, { value: range.lineHeight, unit: 'PIXELS' });
                }
                if (range.letterSpacing) {
                    layer.setRangeLetterSpacing(start, end, { value: range.letterSpacing, unit: 'PIXELS' });
                }
                if (range.link) {
                    const normalized = normalizeLink(range.link);
                    if (normalized) layer.setRangeHyperlink(start, end, normalized);
                }
            }
        } else {
            if (data.fontSize) layer.fontSize = data.fontSize;
            if (data.textCase) layer.textCase = data.textCase;
            if (data.textDecoration) layer.textDecoration = data.textDecoration;
            if (data.lineHeight) {
                layer.lineHeight = { value: data.lineHeight, unit: 'PIXELS' };
            }
            if (data.letterSpacing) {
                layer.letterSpacing = { value: data.letterSpacing, unit: 'PIXELS' };
            }
            if (data.link) {
                const normalized = normalizeLink(data.link);
                if (normalized) layer.setRangeHyperlink(0, layer.characters.length, normalized);
            }
        }

        if (data.textAlignHorizontal) layer.textAlignHorizontal = data.textAlignHorizontal;
    } else if (data.type === 'SVG') {
        try {
            layer = figma.createNodeFromSvg(data.svgContent);
        } catch (e) {
            console.error("SVG creation failed", e);
            layer = figma.createFrame();
            layer.name = "SVG (Failed to import)";
        }
    } else if (data.type === 'IMAGE') {
        layer = figma.createRectangle();
        layer.name = "Image: " + (data.name || "IMG");
        // Placeholder for image fill - fetching image data is complex, 
        // we'll just color it gray for now or try to use figma.createImageAsync
    } else {
        layer = figma.createFrame();
        if (data.clipsContent !== undefined) {
            layer.clipsContent = data.clipsContent;
        }
    }

    layer.name = data.name || "Layer";

    // Sizing
    const w = Math.max(data.width, 0.01);
    const h = Math.max(data.height, 0.01);
    layer.resize(w, h);

    // Positioning
    // data.x/y are global (scrolled) coordinates from the browser.
    // We place the layer relative to its Figma parent.
    layer.x = data.x - parentGlobalX;
    layer.y = data.y - parentGlobalY;

    if (data.cornerRadius) {
        layer.cornerRadius = data.cornerRadius;
    }

    if (data.opacity !== undefined) {
        layer.opacity = data.opacity;
    }

    // Effects (Shadows, Blurs)
    if (data.effects && data.effects.length > 0) {
        layer.effects = data.effects;
    }

    // Fills
    if (data.fills && data.fills.length > 0) {
        layer.fills = data.fills.map(f => ({
            type: f.type,
            color: f.color,
            opacity: f.opacity !== undefined ? f.opacity : 1
        }));
    } else if (data.type === 'FRAME') {
        layer.fills = [];
    }

    // Strokes
    if (data.strokes && data.strokes.length > 0) {
        layer.strokes = data.strokes.map(s => ({
            type: s.type,
            color: s.color,
            opacity: s.opacity !== undefined ? s.opacity : 1
        }));

        layer.strokeAlign = 'INSIDE';

        if (data.strokeTopWeight !== undefined) {
            layer.strokeTopWeight = data.strokeTopWeight;
            layer.strokeRightWeight = data.strokeRightWeight;
            layer.strokeBottomWeight = data.strokeBottomWeight;
            layer.strokeLeftWeight = data.strokeLeftWeight;
        } else {
            layer.strokeWeight = data.strokeWeight || 1;
        }
    }

    if (parent) {
        parent.appendChild(layer);
    }

    // Children
    if (data.children && data.children.length > 0) {
        for (const childData of data.children) {
            // Pass THIS layer's global coordinates for child relative positioning
            await createLayer(childData, layer, data.x, data.y);
        }
    }

    return layer;
}

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'IMPORT') {
        try {
            const { data } = msg;
            if (!data || typeof data !== 'object') {
                throw new Error("Invalid or empty data received.");
            }
            // Start with global offsets 0,0 for the root (BODY)
            const rootLayer = await createLayer(data, null, 0, 0);
            figma.viewport.scrollAndZoomIntoView([rootLayer]);
            figma.notify("Imported successfully!");
        } catch (error) {
            console.error(error);
            figma.notify("Error: " + error.message, { error: true });
        }
    }
};
