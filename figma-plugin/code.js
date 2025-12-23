figma.showUI(__html__, { width: 300, height: 400 });

async function createLayer(data, parent, parentGlobalX = 0, parentGlobalY = 0) {
    let layer;

    if (data.type === 'TEXT') {
        const family = data.fontFamily || "Inter";
        const style = data.fontWeight && data.fontWeight.toString().includes('bold') ? "Bold" : "Regular";

        try {
            await figma.loadFontAsync({ family, style });
            layer = figma.createText();
            layer.fontName = { family, style };
        } catch (e) {
            console.warn(`Could not load font ${family} ${style}, falling back to Inter Regular`);
            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            layer = figma.createText();
            layer.fontName = { family: "Inter", style: "Regular" };
        }

        layer.characters = data.characters || "";
        if (data.fontSize) layer.fontSize = data.fontSize;
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
        layer.strokeWeight = data.strokeWeight || 1;
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
