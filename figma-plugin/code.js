figma.showUI(__html__, { width: 300, height: 400 });

function normalizeLink(link) {
    if (!link) return null;
    if (link.type === 'URL' && link.value) return link;
    if (link.url) return { type: 'URL', value: link.url };
    return null;
}

async function safeLoadFont(fontName) {
    const { family, style } = fontName;

    const variations = [style];

    // Variation 1: Space adjustments
    variations.push(style.replace(/\s+/g, '')); // Semi Bold -> SemiBold
    variations.push(style.replace(/([a-z])([A-Z])/g, '$1 $2')); // SemiBold -> Semi Bold

    // Variation 2: Semantic fallbacks (if bold-ish styles fail)
    if (style.toLowerCase().includes('bold') || style.toLowerCase().includes('semi')) {
        variations.push("Bold");
        variations.push("Semi Bold");
        variations.push("Medium");
    }

    variations.push("Regular");

    for (const v of [...new Set(variations)]) { // Unique variations
        try {
            const f = { family, style: v };
            await figma.loadFontAsync(f);
            return f;
        } catch (e) { }
    }

    try {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        return { family: "Inter", style: "Regular" };
    } catch (e) {
        return figma.createText().fontName;
    }
}

async function createLayer(data, parent, parentGlobalX = 0, parentGlobalY = 0) {
    // Helper to recursively fix SVG stroke weights (default 2 -> 1)
    function fixSvgStrokes(node) {
        if ('children' in node) {
            for (const child of node.children) {
                fixSvgStrokes(child);
            }
        }
        if ('strokeWeight' in node && node.strokeWeight === 2) {
            node.strokeWeight = 1;
        }
    }

    let layer;

    if (data.type === 'TEXT') {
        const family = data.fontFamily || "Inter";
        const isItalic = data.fontStyle === 'italic';

        // Improved weight mapping
        let weightStr = (data.fontWeight || 'regular').toString().toLowerCase();
        let styleName = "Regular";

        const weights = {
            'light': 'Light',
            'regular': 'Regular',
            'medium': 'Medium',
            'semibold': 'Semi Bold',
            'bold': 'Bold',
            'extrabold': 'Extra Bold',
            'black': 'Black'
        };

        if (weights[weightStr]) {
            styleName = weights[weightStr];
        }

        if (isItalic) {
            styleName = styleName === "Regular" ? "Italic" : `${styleName} Italic`;
        }

        const loadedFont = await safeLoadFont({ family, style: styleName });
        layer = figma.createText();
        layer.fontName = loadedFont;

        // If vertical alignment is specified and not TOP, we should keep the box height 
        // to allow Figma's vertical centering to work. 
        if (data.textAlignVertical && data.textAlignVertical !== 'TOP') {
            layer.textAutoResize = "NONE"; // Fixed size allows vertical alignment
            layer.textAlignVertical = data.textAlignVertical;
        } else {
            layer.textAutoResize = "WIDTH_AND_HEIGHT";
        }

        if (data.textIndent) {
            layer.paragraphIndent = data.textIndent;
        }

        layer.characters = data.characters || "";

        if (data.styleRanges && data.styleRanges.length > 0) {
            // ... (pre-load logic)
            for (const range of data.styleRanges) {
                const rIsItalic = range.fontStyle === 'italic';
                let rWeightStr = (range.fontWeight || 'regular').toString().toLowerCase();
                let rStyleName = weights[rWeightStr] || "Regular";

                if (rIsItalic) {
                    rStyleName = rStyleName === "Regular" ? "Italic" : `${rStyleName} Italic`;
                }

                const fontToLoad = { family: range.fontFamily || "Inter", style: rStyleName };
                const loaded = await safeLoadFont(fontToLoad);
                range.actualFontName = loaded;
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
                if (range.listOptions) {
                    layer.setRangeListOptions(start, end, range.listOptions);
                    layer.hangingList = true;
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
        if (data.textAlignVertical) layer.textAlignVertical = data.textAlignVertical;
    } else if (data.type === 'SVG') {
        try {
            layer = figma.createNodeFromSvg(data.svgContent);
            fixSvgStrokes(layer);
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
    } else if (data.type === 'RECTANGLE') {
        layer = figma.createRectangle();
    } else {
        layer = figma.createFrame();
        if (data.clipsContent !== undefined) {
            layer.clipsContent = data.clipsContent;
        }
    }

    layer.name = data.name || "Layer";

    // Auto Layout Support (Flexbox & Tables)
    const isFlex = data.display === 'flex' || data.display === 'inline-flex';
    const isTable = data.isTable;
    const isTableGroup = data.isTableGroup;
    const isTableRow = data.isTableRow;

    if (data.type === 'FRAME' && (isFlex || isTable || isTableGroup || isTableRow)) {
        if (isTable || isTableGroup) {
            layer.layoutMode = 'VERTICAL';
            layer.itemSpacing = data.tableRowGap || 0;
        } else if (isTableRow) {
            layer.layoutMode = 'HORIZONTAL';
            layer.itemSpacing = data.tableColGap || 0;
        } else {
            // Standard Flexbox
            layer.layoutMode = data.flexDirection === 'column' ? 'VERTICAL' : 'HORIZONTAL';
            let spacing = data.flexDirection === 'column' ? (data.rowGap || 0) : (data.columnGap || 0);

            // If gap is 0, check if children have margins (common in space-x/y patterns)
            if (spacing === 0 && data.children && data.children.length > 1) {
                // Check second child for margin (skip first as it often has 0 margin in space-x)
                const secondChild = data.children[1];
                if (data.flexDirection === 'column') {
                    spacing = Math.max(secondChild.marginTop || 0, 0);
                } else {
                    spacing = Math.max(secondChild.marginLeft || 0, 0);
                }
            }
            layer.itemSpacing = spacing;
        }

        // Alignment (Flexbox only for now, Tables usually use internal cell alignment or legacy align props)
        // For tables, we mostly rely on the fact that rows fill the table width and cells fill row height
        if (isFlex) {
            const items = data.alignItems;
            const content = data.justifyContent;

            if (layer.layoutMode === 'HORIZONTAL') {
                if (content === 'center') layer.primaryAxisAlignItems = 'CENTER';
                else if (content === 'flex-end' || content === 'end') layer.primaryAxisAlignItems = 'MAX';
                else if (content === 'space-between') layer.primaryAxisAlignItems = 'SPACE_BETWEEN';

                if (items === 'center') layer.counterAxisAlignItems = 'CENTER';
                else if (items === 'flex-end' || items === 'end') layer.counterAxisAlignItems = 'MAX';
            } else {
                if (content === 'center') layer.primaryAxisAlignItems = 'CENTER';
                else if (content === 'flex-end' || content === 'end') layer.primaryAxisAlignItems = 'MAX';
                else if (content === 'space-between') layer.primaryAxisAlignItems = 'SPACE_BETWEEN';

                if (items === 'center') layer.counterAxisAlignItems = 'CENTER';
                else if (items === 'flex-end' || items === 'end') layer.counterAxisAlignItems = 'MAX';
            }
        }

        layer.paddingTop = data.paddingTop || 0;
        layer.paddingRight = data.paddingRight || 0;
        layer.paddingBottom = data.paddingBottom || 0;
        layer.paddingLeft = data.paddingLeft || 0;
    }

    // Sizing
    const w = Math.max(data.width, 0.01);
    const h = Math.max(data.height, 0.01);
    layer.resize(w, h);

    // Positioning
    // data.x/y are global (scrolled) coordinates from the browser.
    // We place the layer relative to its Figma parent.
    layer.x = data.x - parentGlobalX;
    layer.y = data.y - parentGlobalY;

    if (data.topLeftRadius !== undefined) {
        layer.topLeftRadius = data.topLeftRadius;
        layer.topRightRadius = data.topRightRadius;
        layer.bottomLeftRadius = data.bottomLeftRadius;
        layer.bottomRightRadius = data.bottomRightRadius;
    } else if (data.cornerRadius) {
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
        layer.fills = data.fills.map(f => {
            if (f.type === 'SOLID') {
                return {
                    type: 'SOLID',
                    color: f.color,
                    opacity: f.opacity !== undefined ? f.opacity : 1
                };
            } else if (f.type === 'GRADIENT_LINEAR') {
                return {
                    type: 'GRADIENT_LINEAR',
                    gradientStops: f.gradientStops,
                    gradientTransform: f.gradientTransform || [[1, 0, 0], [0, 1, 0]]
                };
            }
            return null;
        }).filter(Boolean);
    } else if (data.type === 'FRAME') {
        layer.fills = [];
    }

    // Strokes
    if (data.strokes && data.strokes.length > 0) {
        // Detect Circle with Unequal Borders (e.g. Spinner)
        const isCircle = (data.type === 'FRAME' || data.type === 'ELLIPSE') &&
            Math.abs(data.width - data.height) < 2 &&
            (data.cornerRadius >= (data.width / 2 - 2) || (data.topLeftRadius >= (data.width / 2 - 2)));

        const t = data.strokeTopWeight || 0;
        const r = data.strokeRightWeight || 0;
        const b = data.strokeBottomWeight || 0;
        const l = data.strokeLeftWeight || 0;
        const hasUnequalBorders = (t !== r || r !== b || b !== l || l !== t);

        if (isCircle && hasUnequalBorders) {
            // Render as Donut Arcs (simulating CSS partial borders on circles)
            // We use the first stroke color (limitation: assumes uniform color or takes first)
            const strokeColor = data.strokes[0].color;
            const opacity = data.strokes[0].opacity !== undefined ? data.strokes[0].opacity : 1;

            const sectors = [
                { w: t, start: -135, end: -45, name: 'Border Top' },    // Top
                { w: r, start: -45, end: 45, name: 'Border Right' },    // Right
                { w: b, start: 45, end: 135, name: 'Border Bottom' },   // Bottom
                { w: l, start: 135, end: 225, name: 'Border Left' }     // Left
            ];

            const rad = d => d * Math.PI / 180;
            const radius = data.width / 2;

            for (const s of sectors) {
                if (s.w > 0) {
                    const arc = figma.createEllipse();
                    arc.name = s.name;
                    arc.resize(data.width, data.height);
                    arc.x = 0; arc.y = 0;

                    // Donut Fill Logic
                    arc.fills = [{ type: 'SOLID', color: strokeColor, opacity }];
                    arc.strokes = [];

                    const innerR = (radius - s.w) / radius;
                    arc.arcData = {
                        startingAngle: rad(s.start),
                        endingAngle: rad(s.end),
                        innerRadius: Math.max(0, innerR)
                    };

                    layer.appendChild(arc);
                }
            }

            // Clear frame strokes since we handle them with children
            layer.strokes = [];

        } else {
            // Standard Frame Strokes
            layer.strokes = data.strokes.map(s => ({
                type: s.type,
                color: s.color,
                opacity: s.opacity !== undefined ? s.opacity : 1
            }));

            layer.strokeAlign = 'INSIDE';

            if (data.strokeTopWeight !== undefined && (data.strokeTopWeight > 0 || data.strokeRightWeight > 0 || data.strokeBottomWeight > 0 || data.strokeLeftWeight > 0)) {
                layer.strokeTopWeight = data.strokeTopWeight;
                layer.strokeRightWeight = data.strokeRightWeight;
                layer.strokeBottomWeight = data.strokeBottomWeight;
                layer.strokeLeftWeight = data.strokeLeftWeight;
            } else {
                layer.strokeWeight = (data.strokeWeight !== undefined) ? data.strokeWeight : 1;
            }
        }
    } else {
        // Even if no strokes are defined (e.g. SVG import handled purely by shape), 
        // ensure default property is set to 1 instead of Figma's potential internal default of 2-4
        if ('strokeWeight' in layer) {
            layer.strokeWeight = (data.strokeWeight !== undefined) ? data.strokeWeight : 1;
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
