const IGNORED_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'BR', 'VIDEO', 'CANVAS', 'OBJECT', 'EMBED'];
const INLINE_TAGS = ['SPAN', 'STRONG', 'B', 'EM', 'I', 'A', 'CODE', 'SUB', 'SUP', 'LABEL', 'MARK', 'SMALL', 'BR'];

/**
 * Utility to convert RGB(A) string to Figma color object
 */
function parseColor(colorString) {
    if (!colorString || colorString === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const match = colorString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return { r: 0, g: 0, b: 0, a: 1 };
    return {
        r: parseInt(match[1]) / 255,
        g: parseInt(match[2]) / 255,
        b: parseInt(match[3]) / 255,
        a: match[4] ? parseFloat(match[4]) : 1
    };
}

/**
 * Inlines computed styles and resolves external references (gradients, etc.) into SVG string
 */
function inlineSvgStyles(svgElement) {
    const cloned = svgElement.cloneNode(true);
    const referencedIds = new Set();

    function applyStyles(original, clone) {
        const style = window.getComputedStyle(original);

        // Attributes to inline for Figma to recognize
        const attrs = {
            'fill': 'fill',
            'stroke': 'stroke',
            'stroke-width': 'stroke-width',
            'opacity': 'opacity',
            'display': 'display'
        };

        for (const [prop, attr] of Object.entries(attrs)) {
            const val = style.getPropertyValue(prop);
            if (val && val !== 'none' && val !== '0px' && val !== 'normal') {
                clone.setAttribute(attr, val);

                // Collect url(#id) references
                const urlMatch = val.match(/url\(['"]?#([^'"]+)['"]?\)/);
                if (urlMatch) {
                    referencedIds.add(urlMatch[1]);
                }
            }
        }

        // Recursively handle children
        for (let i = 0; i < original.children.length; i++) {
            if (clone.children[i]) {
                applyStyles(original.children[i], clone.children[i]);
            }
        }
    }

    applyStyles(svgElement, cloned);

    // Resolve external references (gradients, etc.)
    if (referencedIds.size > 0) {
        let defs = cloned.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            cloned.insertBefore(defs, cloned.firstChild);
        }

        for (const id of referencedIds) {
            // Check if ID already exists in this SVG
            if (cloned.querySelector(`#${id}`)) continue;

            const externalRef = document.getElementById(id);
            if (externalRef && (externalRef instanceof SVGGradientElement || externalRef.tagName === 'pattern' || externalRef.tagName === 'mask')) {
                defs.appendChild(externalRef.cloneNode(true));
            }
        }
    }

    return cloned.outerHTML;
}

/**
 * Parses box-shadow string into Figma effects
 */
function parseShadows(shadowString) {
    if (!shadowString || shadowString === 'none') return [];

    // Split by comma but not within rgb/rgba
    const shadows = shadowString.split(/,(?![^(]*\))/);
    return shadows.map(s => {
        const parts = s.trim().split(/\s+(?![^(]*\))/);
        const inset = parts.includes('inset');
        const colorPart = parts.find(p => p.includes('rgb') || p.startsWith('#'));
        const color = parseColor(colorPart);

        // Remove inset and color to get numbers
        const numbers = parts.filter(p => p !== 'inset' && p !== colorPart).map(p => parseFloat(p));

        return {
            type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
            color: { r: color.r, g: color.g, b: color.b, a: color.a },
            offset: { x: numbers[0] || 0, y: numbers[1] || 0 },
            radius: numbers[2] || 0,
            spread: numbers[3] || 0,
            visible: true,
            blendMode: 'NORMAL'
        };
    });
}

/**
 * Parses filter/backdrop-filter for blur
 */
function parseBlur(filterString) {
    if (!filterString || filterString === 'none') return null;
    const match = filterString.match(/blur\((\d+)(?:px)?\)/);
    if (!match) return null;
    return parseFloat(match[1]);
}

/**
 * Collapses HTML whitespace: replaces tabs, newlines, and multiple spaces with a single space.
 * Trims leading/trailing whitespace if requested.
 */
function collapseWhitespace(text, trim = false) {
    let collapsed = text.replace(/[\t\n\r ]+/g, ' ');
    return trim ? collapsed.trim() : collapsed;
}

/**
 * Parses CSS linear-gradient into Figma fills
 */
function parseGradients(gradientString) {
    if (!gradientString || gradientString === 'none' || !gradientString.includes('gradient')) return [];

    // Very basic linear-gradient parser
    const match = gradientString.match(/linear-gradient\((.*)\)/);
    if (!match) return [];

    const parts = match[1].split(/,(?![^(]*\))/);
    const stops = [];

    // Simplistic stop extraction
    for (const part of parts) {
        const colorMatch = part.match(/rgba?\(.*?\)|#[a-fA-F0-0]{3,6}/);
        if (colorMatch) {
            const color = parseColor(colorMatch[0]);
            stops.push({
                color: { r: color.r, g: color.g, b: color.b, a: color.a },
                position: stops.length / (parts.length - 1) // Rough estimation
            });
        }
    }

    if (stops.length < 2) return [];

    return [{
        type: 'GRADIENT_LINEAR',
        gradientStops: stops,
        gradientTransform: [[1, 0, 0], [0, 1, 0]] // Default to top-to-bottom
    }];
}


/**
 * Checks if an element should be captured as a single Rich Text layer
 * We skip this if the element itself has visible backgrounds/borders that need to be preserved as a Frame.
 */
function isTextContainer(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.childNodes.length === 0) return false;

    const style = window.getComputedStyle(node);
    const hasVisibleBackground = (parseColor(style.backgroundColor).a > 0) || (style.backgroundImage && style.backgroundImage !== 'none');
    const hasVisibleBorder = parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderRightWidth) > 0 || parseFloat(style.borderBottomWidth) > 0 || parseFloat(style.borderLeftWidth) > 0;

    // If it has a background or border, we want to capture it as a Frame with children, not just a flattened TEXT node
    if (hasVisibleBackground || hasVisibleBorder) return false;

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) continue;
        if (child.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.includes(child.tagName)) {
            // Check if inline child has background/border
            const childStyle = window.getComputedStyle(child);
            if (parseColor(childStyle.backgroundColor).a > 0 || (childStyle.backgroundImage && childStyle.backgroundImage !== 'none')) return false;
            continue;
        }
        return false;
    }
    return true;
}

/**
 * Computes the marker (bullet/number) for a list item
 */
function getListItemMarkerType(element) {
    const style = window.getComputedStyle(element);
    const listStyleType = style.listStyleType;

    if (listStyleType === 'none') return null;

    if (listStyleType.includes('decimal') || listStyleType.includes('roman') || listStyleType.includes('alpha')) {
        return 'ORDERED';
    }

    return 'UNORDERED';
}

/**
 * Detects the effective text decoration for an element by traversing up the DOM tree.
 * Propagated decorations (like underlines from links) are not strictly inherited 
 * but are rendered on all text descendants.
 */
function getEffectiveTextDecoration(element) {
    let current = element;
    let underline = false;
    let strikethrough = false;

    while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const line = style.textDecorationLine;
        if (line.includes('underline')) underline = true;
        if (line.includes('line-through')) strikethrough = true;

        // Stop if we find an anchor tag that might be defining the decoration
        // or a block element that might break decoration propagation (though rare)
        current = current.parentElement;
    }

    if (underline && strikethrough) return 'STRIKETHROUGH_AND_UNDERLINE'; // Figma doesn't support both simultaneously easily, prioritize
    if (strikethrough) return 'STRIKETHROUGH';
    if (underline) return 'UNDERLINE';
    return 'NONE';
}

/**
 * Builds styling ranges and full text for a rich text container
 */
function getRichTextData(element) {
    let text = "";
    const ranges = [];

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            let content = node.textContent;
            // Collapse whitespace within this chunk
            content = collapseWhitespace(content);
            if (content.length > 0) {
                const parent = node.parentElement;
                const styles = getStyles(parent);
                const range = {
                    start: text.length,
                    end: text.length + content.length,
                    fontSize: styles.fontSize,
                    fontFamily: styles.fontFamily,
                    fontWeight: styles.fontWeight,
                    fontStyle: styles.fontStyle,
                    fill: { type: 'SOLID', color: { r: styles.color.r, g: styles.color.g, b: styles.color.b }, opacity: styles.color.a },
                    textCase: styles.textTransform === 'uppercase' ? 'UPPER' : (styles.textTransform === 'lowercase' ? 'LOWER' : (styles.textTransform === 'capitalize' ? 'TITLE' : 'ORIGINAL')),
                    textDecoration: getEffectiveTextDecoration(parent),
                    lineHeight: styles.lineHeight,
                    letterSpacing: styles.letterSpacing
                };

                const linkParent = node.parentElement.closest('a');
                if (linkParent && linkParent.href) {
                    range.link = { type: 'URL', value: linkParent.href };
                }

                ranges.push(range);
                text += content;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none') return;

            if (node.tagName === 'BR') {
                text += "\n";
            } else {
                for (const child of node.childNodes) {
                    walk(child);
                }
            }
        }
    }

    walk(element);
    // Trim and adjust ranges
    const originalLength = text.length;
    text = text.trim();
    const diff = originalLength - text.length;
    if (diff > 0) {
        const leadingSpaces = originalLength - text.replace(/^\s+/, '').length;
        for (const range of ranges) {
            range.start = Math.max(0, range.start - leadingSpaces);
            range.end = Math.max(0, range.end - leadingSpaces);
        }
    }

    // Add list marker metadata if this is an LI
    if (element.tagName === 'LI') {
        const listType = getListItemMarkerType(element);
        if (listType) {
            // Apply list metadata to all ranges in this LI
            for (const range of ranges) {
                range.listOptions = { type: listType };
            }
        }
    }

    return { text, ranges };
}

/**
 * Normalize font weight for Figma
 * Mapping numeric weights to common strings or returning the number
 */
function normalizeFontWeight(weight) {
    const numericWeight = parseInt(weight);
    if (!isNaN(numericWeight)) {
        if (numericWeight <= 300) return 'light';
        if (numericWeight <= 400) return 'regular';
        if (numericWeight <= 500) return 'medium';
        if (numericWeight <= 600) return 'semibold';
        if (numericWeight <= 700) return 'bold';
        if (numericWeight <= 800) return 'extrabold';
        return 'black';
    }
    const w = weight.toLowerCase();
    if (w === 'normal') return 'regular';
    return w;
}

/**
 * Capture basic styles for a node
 */
function getStyles(element) {
    const style = window.getComputedStyle(element);
    const bgColor = parseColor(style.backgroundColor);
    const color = parseColor(style.color);

    // Clean up font family: take first one, remove quotes
    let fontFamily = style.fontFamily.split(',')[0].replace(/['"]/g, '').trim();

    return {
        backgroundColor: bgColor,
        color: color,
        fontSize: parseFloat(style.fontSize) || 16,
        fontWeight: normalizeFontWeight(style.fontWeight),
        fontStyle: style.fontStyle,
        fontFamily: fontFamily,
        textAlign: style.textAlign,
        lineHeight: parseFloat(style.lineHeight) || undefined,
        letterSpacing: parseFloat(style.letterSpacing) || 0,
        textIndent: parseFloat(style.textIndent) || 0,
        textTransform: style.textTransform,
        textDecorationLine: style.textDecorationLine,
        borderRadius: parseFloat(style.borderRadius) || 0,
        topLeftRadius: parseFloat(style.borderTopLeftRadius) || 0,
        topRightRadius: parseFloat(style.borderTopRightRadius) || 0,
        bottomLeftRadius: parseFloat(style.borderBottomLeftRadius) || 0,
        bottomRightRadius: parseFloat(style.borderBottomRightRadius) || 0,
        paddingTop: parseFloat(style.paddingTop) || 0,
        paddingRight: parseFloat(style.paddingRight) || 0,
        paddingBottom: parseFloat(style.paddingBottom) || 0,
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        opacity: parseFloat(style.opacity) || 1,
        overflow: style.overflow,
        boxShadow: style.boxShadow,
        filter: style.filter,
        backdropFilter: style.backdropFilter,
        backgroundImage: style.backgroundImage,
        borderTopWidth: (style.borderTopStyle !== 'none' && style.borderTopStyle !== 'hidden') ? parseFloat(style.borderTopWidth) : 0,
        borderTopColor: parseColor(style.borderTopColor),
        borderRightWidth: (style.borderRightStyle !== 'none' && style.borderRightStyle !== 'hidden') ? parseFloat(style.borderRightWidth) : 0,
        borderRightColor: parseColor(style.borderRightColor),
        borderBottomWidth: (style.borderBottomStyle !== 'none' && style.borderBottomStyle !== 'hidden') ? parseFloat(style.borderBottomWidth) : 0,
        borderBottomColor: parseColor(style.borderBottomColor),
        borderLeftWidth: (style.borderLeftStyle !== 'none' && style.borderLeftStyle !== 'hidden') ? parseFloat(style.borderLeftWidth) : 0,
        borderLeftColor: parseColor(style.borderLeftColor),
        display: style.display,
        flexDirection: style.flexDirection,
        alignItems: style.alignItems,
        justifyContent: style.justifyContent,
        verticalAlign: style.verticalAlign,
    };
}

/**
 * Traverses DOM and returns Figma-compatible JSON
 * @param {Node} node
 * @param {number} depth
 * @param {Set<Node>} skipNodes Nodes to skip during traversal (already captured in other groups)
 */
function captureNode(node, depth = 0, skipNodes = new Set()) {
    if (depth > 50) return null;
    if (skipNodes.has(node)) return null;

    if (node.nodeType === Node.TEXT_NODE) {
        const textContent = collapseWhitespace(node.textContent, true);
        if (!textContent) return null;

        const parent = node.parentElement;
        if (!parent) return null;

        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parseFloat(parentStyle.opacity) === 0) return null;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = range.getClientRects();
        if (rects.length === 0) return null;

        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const r of rects) {
            left = Math.min(left, r.left);
            top = Math.min(top, r.top);
            right = Math.max(right, r.right);
            bottom = Math.max(bottom, r.bottom);
        }

        const styles = getStyles(parent);

        // Map alignment
        let textAlignHorizontal = styles.textAlign.toUpperCase();
        if (textAlignHorizontal === 'START') textAlignHorizontal = 'LEFT';
        if (textAlignHorizontal === 'END') textAlignHorizontal = 'RIGHT';
        if (textAlignHorizontal === 'JUSTIFY') textAlignHorizontal = 'JUSTIFIED';
        if (!['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'].includes(textAlignHorizontal)) textAlignHorizontal = 'LEFT';

        // Map vertical alignment
        let textAlignVertical = 'TOP';
        if (styles.verticalAlign === 'middle') textAlignVertical = 'CENTER';
        else if (styles.verticalAlign === 'bottom') textAlignVertical = 'BOTTOM';

        // Check parent's flex/grid alignment
        const parentNode = node.parentElement;
        if (parentNode) {
            const pStyle = window.getComputedStyle(parentNode);
            if (pStyle.display === 'flex' || pStyle.display === 'inline-flex' || pStyle.display === 'grid') {
                if (pStyle.alignItems === 'center') textAlignVertical = 'CENTER';
                else if (pStyle.alignItems === 'flex-end' || pStyle.alignItems === 'end') textAlignVertical = 'BOTTOM';
            }
        }

        const linkParent = parent.closest('a');
        const link = (linkParent && linkParent.href) ? { type: 'URL', value: linkParent.href } : undefined;

        return {
            name: 'Text',
            type: 'TEXT',
            x: left + window.scrollX,
            y: top + window.scrollY,
            width: right - left,
            height: bottom - top,
            characters: textContent,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
            fontWeight: styles.fontWeight,
            textAlignHorizontal: textAlignHorizontal,
            lineHeight: styles.lineHeight,
            letterSpacing: styles.letterSpacing,
            fontStyle: styles.fontStyle,
            textIndent: styles.textIndent,
            link: link,
            textAlignVertical: textAlignVertical,
            textCase: styles.textTransform === 'uppercase' ? 'UPPER' : (styles.textTransform === 'lowercase' ? 'LOWER' : (styles.textTransform === 'capitalize' ? 'TITLE' : 'ORIGINAL')),
            textDecoration: getEffectiveTextDecoration(parent),
            fills: [{ type: 'SOLID', color: { r: styles.color.r, g: styles.color.g, b: styles.color.b }, opacity: styles.color.a }]
        };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (IGNORED_TAGS.includes(node.tagName)) return null;

    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return null;

    const rect = node.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1 && node.tagName !== 'BODY') return null;

    const styles = getStyles(node);
    const type = node.tagName === 'IMG' ? 'IMAGE' : (node.tagName === 'svg' || node.tagName === 'SVG' ? 'SVG' : 'FRAME');

    const absX = rect.left + window.scrollX;
    const absY = rect.top + window.scrollY;

    const layer = {
        name: (node.id ? `#${node.id}` : '') || node.tagName,
        type: type,
        x: absX,
        y: absY,
        width: rect.width,
        height: rect.height,
        cornerRadius: styles.borderRadius,
        topLeftRadius: styles.topLeftRadius,
        topRightRadius: styles.topRightRadius,
        bottomLeftRadius: styles.bottomLeftRadius,
        bottomRightRadius: styles.bottomRightRadius,
        opacity: styles.opacity,
        clipsContent: styles.overflow !== 'visible',
        fills: [],
        effects: [],
        children: []
    };

    // RICH TEXT SUPPORT: If this is a text container or an LI, capture its contents as a single layer
    if ((isTextContainer(node) || node.tagName === 'LI') && (node.childNodes.length > 0)) {
        const richText = getRichTextData(node);
        if (richText.ranges.length > 0) {
            let textAlignHorizontal = styles.textAlign.toUpperCase();
            if (textAlignHorizontal === 'START') textAlignHorizontal = 'LEFT';
            if (textAlignHorizontal === 'END') textAlignHorizontal = 'RIGHT';
            if (textAlignHorizontal === 'JUSTIFY') textAlignHorizontal = 'JUSTIFIED';
            if (!['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'].includes(textAlignHorizontal)) textAlignHorizontal = 'LEFT';

            // Map vertical alignment for rich text
            let textAlignVertical = 'TOP';
            if (styles.display === 'flex' || styles.display === 'inline-flex' || styles.display === 'grid') {
                if (styles.alignItems === 'center') textAlignVertical = 'CENTER';
                else if (styles.alignItems === 'flex-end' || styles.alignItems === 'end') textAlignVertical = 'BOTTOM';
            }

            layer.children.push({
                name: 'Rich Text',
                type: 'TEXT',
                x: absX,
                y: absY,
                width: rect.width,
                height: rect.height,
                characters: richText.text,
                fontSize: styles.fontSize,
                fontFamily: styles.fontFamily,
                fontWeight: styles.fontWeight,
                textAlignHorizontal: textAlignHorizontal,
                textAlignVertical: textAlignVertical,
                lineHeight: styles.lineHeight,
                styleRanges: richText.ranges,
                fills: [{ type: 'SOLID', color: { r: styles.color.r, g: styles.color.g, b: styles.color.b }, opacity: styles.color.a }]
            });
            return layer;
        }
    }

    // Effects: Shadows
    if (styles.boxShadow !== 'none') {
        const shadows = parseShadows(styles.boxShadow);
        layer.effects.push(...shadows);
    }

    // Effects: Blur
    const blur = parseBlur(styles.filter);
    if (blur) {
        layer.effects.push({
            type: 'LAYER_BLUR',
            radius: blur,
            visible: true
        });
    }

    // Effects: Background Blur
    const bgBlur = parseBlur(styles.backdropFilter);
    if (bgBlur) {
        layer.effects.push({
            type: 'BACKGROUND_BLUR',
            radius: bgBlur,
            visible: true
        });
    }


    if (type === 'SVG') {
        layer.svgContent = inlineSvgStyles(node);
        // Don't recurse into SVG children, Figma handles the whole string
        return layer;
    }

    if (node.tagName === 'IMG') {
        layer.imageUrl = node.src;
    }

    if (styles.backgroundColor.a > 0) {
        layer.fills.push({
            type: 'SOLID',
            color: { r: styles.backgroundColor.r, g: styles.backgroundColor.g, b: styles.backgroundColor.b },
            opacity: styles.backgroundColor.a
        });
    }

    if (styles.backgroundImage && styles.backgroundImage !== 'none') {
        const gradients = parseGradients(styles.backgroundImage);
        layer.fills.push(...gradients);
    }

    const borderWeights = {
        top: styles.borderTopWidth,
        right: styles.borderRightWidth,
        bottom: styles.borderBottomWidth,
        left: styles.borderLeftWidth
    };

    if (borderWeights.top > 0 || borderWeights.right > 0 || borderWeights.bottom > 0 || borderWeights.left > 0) {
        // Pick the first non-zero color for the stroke
        const bColor = (borderWeights.top > 0 ? styles.borderTopColor :
            (borderWeights.right > 0 ? styles.borderRightColor :
                (borderWeights.bottom > 0 ? styles.borderBottomColor :
                    styles.borderLeftColor)));

        layer.strokes = [{
            type: 'SOLID',
            color: { r: bColor.r, g: bColor.g, b: bColor.b },
            opacity: bColor.a
        }];

        layer.strokeTopWeight = borderWeights.top;
        layer.strokeRightWeight = borderWeights.right;
        layer.strokeBottomWeight = borderWeights.bottom;
        layer.strokeLeftWeight = borderWeights.left;
        layer.strokeWeight = Math.max(borderWeights.top, borderWeights.right, borderWeights.bottom, borderWeights.left);
    }

    let childCount = 0;
    for (const child of node.childNodes) {
        if (childCount > 500) break;
        const childLayer = captureNode(child, depth + 1, skipNodes);
        if (childLayer) {
            layer.children.push(childLayer);
            childCount++;
        }
    }

    return layer;
}

/**
 * Finds all elements with a specific position that don't have an ancestor with that same position
 */
function findRootPositionedElements(rootNode, positions) {
    const roots = [];
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const style = window.getComputedStyle(node);
            if (positions.includes(style.position)) {
                return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
        }
    });

    let node;
    while (node = walker.nextNode()) {
        // Check if any ancestor is already in roots
        let hasAncestorInRoots = false;
        let parent = node.parentElement;
        while (parent && parent !== rootNode) {
            const parentStyle = window.getComputedStyle(parent);
            if (positions.includes(parentStyle.position)) {
                hasAncestorInRoots = true;
                break;
            }
            parent = parent.parentElement;
        }

        if (!hasAncestorInRoots) {
            roots.push(node);
        }
    }
    return roots;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CAPTURE') {
        try {
            const fixedRoots = findRootPositionedElements(document.body, ['fixed']);
            const stickyRoots = findRootPositionedElements(document.body, ['sticky']);

            const skipNodes = new Set([...fixedRoots, ...stickyRoots]);

            const fixedGroup = {
                name: "Fixed Elements",
                type: "FRAME",
                x: 0,
                y: 0,
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
                children: fixedRoots.map(node => captureNode(node, 0, new Set())).filter(Boolean)
            };

            const stickyGroup = {
                name: "Sticky Elements",
                type: "FRAME",
                x: 0,
                y: 0,
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
                children: stickyRoots.map(node => captureNode(node, 0, new Set())).filter(Boolean)
            };

            const otherGroup = captureNode(document.body, 0, skipNodes);
            if (otherGroup) {
                otherGroup.name = "Other Elements";
            }

            const root = {
                name: "Page",
                type: "FRAME",
                x: 0,
                y: 0,
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
                children: [otherGroup, stickyGroup, fixedGroup].filter(Boolean)
            };

            sendResponse({ data: root });
        } catch (e) {
            console.error(e);
            sendResponse({ error: e.message });
        }
    }
    return true;
});

