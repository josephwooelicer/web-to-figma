const IGNORED_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'BR', 'VIDEO', 'CANVAS', 'OBJECT', 'EMBED'];
const INLINE_TAGS = ['SPAN', 'STRONG', 'B', 'EM', 'I', 'A', 'CODE', 'SUB', 'SUP', 'LABEL', 'MARK', 'SMALL', 'BR'];

/**
 * Utility to convert RGB(A) string to Figma color object
 */
function parseColor(colorString) {
    if (!colorString || colorString === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (colorString.startsWith('#')) {
        const hex = colorString.substring(1);
        let im;
        if (hex.length === 3 || hex.length === 4) {
            im = hex.split('').map(c => parseInt(c + c, 16));
        } else {
            im = hex.match(/.{1,2}/g).map(c => parseInt(c, 16));
        }
        return {
            r: im[0] / 255,
            g: im[1] / 255,
            b: im[2] / 255,
            a: im[3] !== undefined ? im[3] / 255 : 1
        };
    }
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
 * Safe getComputedStyle that handles iframes
 */
function getSafeComputedStyle(element) {
    return (element.ownerDocument && element.ownerDocument.defaultView ? element.ownerDocument.defaultView : window).getComputedStyle(element);
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
            'stroke-linecap': 'stroke-linecap',
            'stroke-linejoin': 'stroke-linejoin',
            'stroke-dasharray': 'stroke-dasharray',
            'stroke-dashoffset': 'stroke-dashoffset',
            'stroke-miterlimit': 'stroke-miterlimit',
            'vector-effect': 'vector-effect',
            'opacity': 'opacity',
            'fill-opacity': 'fill-opacity',
            'stroke-opacity': 'stroke-opacity',
            'stroke-dasharray': 'stroke-dasharray',
            'stroke-dashoffset': 'stroke-dashoffset',
            'display': 'display',
            'visibility': 'visibility',
            'font-family': 'font-family',
            'font-size': 'font-size',
            'font-weight': 'font-weight'
        };

        // Special handling for gradient stop elements
        if (original.tagName === 'stop') {
            const stopColor = style.getPropertyValue('stop-color');
            const stopOpacity = style.getPropertyValue('stop-opacity');

            if (stopColor && stopColor !== 'none') {
                clone.setAttribute('stop-color', stopColor);
            }
            if (stopOpacity && stopOpacity !== 'none' && stopOpacity !== '1') {
                clone.setAttribute('stop-opacity', stopOpacity);
            }

            // Also preserve offset attribute if present
            if (original.hasAttribute('offset')) {
                clone.setAttribute('offset', original.getAttribute('offset'));
            }
        }

        for (const [prop, attr] of Object.entries(attrs)) {
            let val = style.getPropertyValue(prop);
            if (val && val !== 'none' && val !== 'normal') {
                // Normalize numeric values (strip px for SVG attributes)
                if (['stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'font-size'].includes(prop)) {
                    val = val.replace('px', '');
                }

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

    const style = getSafeComputedStyle(node);
    const hasVisibleBackground = (parseColor(style.backgroundColor).a > 0) || (style.backgroundImage && style.backgroundImage !== 'none');
    const hasVisibleBorder = parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderRightWidth) > 0 || parseFloat(style.borderBottomWidth) > 0 || parseFloat(style.borderLeftWidth) > 0;

    // If it has a background or border, we want to capture it as a Frame with children, not just a flattened TEXT node
    if (hasVisibleBackground || hasVisibleBorder) return false;

    // Flex and Grid containers should always be Frames to preserve spacing/layout
    if (style.display === 'flex' || style.display === 'inline-flex' || style.display === 'grid' || style.display === 'inline-grid') {
        return false;
    }

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) continue;
        if (child.nodeType === Node.ELEMENT_NODE) {
            if (!INLINE_TAGS.includes(child.tagName)) return false;

            // Even if it's an inline tag, if it has a background, border, or is a flex/grid container,
            // we want to preserve its structure as a Frame.
            // EXCEPTION: For standard inline text formatting like code, mark, spans, we prefer
            // merging them into the text layer to avoid layout drift, even if we lose the background color.
            const childStyle = getSafeComputedStyle(child);
            const isFlexGrid = childStyle.display === 'flex' || childStyle.display === 'inline-flex' || childStyle.display === 'grid' || childStyle.display === 'inline-grid';

            // If it's a layout container, we must preserve it as a frame
            if (isFlexGrid) return false;

            // Otherwise, for standard inline elements (span, code, etc), accept them into the text node
            // This means visual background/border properties on these specific children will be lost in Figma
            // but the text flow will be correct.
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
    const style = getSafeComputedStyle(element);
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
        const style = getSafeComputedStyle(current);
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
 * Attempts to extract LaTeX/MathML source from a node if it's a math container.
 */
function getMathContent(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;

    // MathJax Container (v3)
    if (node.tagName === 'MJX-CONTAINER') {
        // Try accessing the assistive MML which often contains the TeX annotation
        const assistive = node.querySelector('.mjx-assistive-mml');
        if (assistive) {
            const annotation = assistive.querySelector('annotation[encoding="application/x-tex"]');
            if (annotation) return annotation.textContent.trim();
            // Fallback to aria-label if it looks like TeX
            const aria = node.getAttribute('aria-label');
            if (aria) return aria;
        }
        // If we can't find clear TeX, checking for script tags might be needed but usually mjx-container has accessible parts
    }

    // KaTeX Container
    if (node.classList.contains('katex')) {
        // KaTeX usually has a MathML block with annotation
        const mathML = node.querySelector('annotation[encoding="application/x-tex"]');
        if (mathML) return mathML.textContent.trim();

        // Sometimes the original TeX is in a separate script or just not easily accessible in the DOM structure 
        // without looking at the 'katex-mathml' block
        const mml = node.querySelector('.katex-mathml');
        if (mml) {
            const anno = mml.querySelector('annotation');
            if (anno) return anno.textContent.trim();
            return mml.textContent.trim(); // Fallback
        }
    }

    // Generic MathML
    if (node.tagName === 'MATH') {
        const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        if (annotation) return annotation.textContent.trim();
        // Fallback: try to return purely text content if it's short, might be messy
    }

    return null;
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

            const parent = node.parentElement;
            const parentStyle = getSafeComputedStyle(parent);
            const whiteSpace = parentStyle.whiteSpace;
            const preserveWhitespace = ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(whiteSpace);

            if (!preserveWhitespace) {
                // Collapse whitespace within this chunk
                content = collapseWhitespace(content);
            }

            if (content.length > 0) {
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
            const style = getSafeComputedStyle(node);
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

    const containerStyle = getSafeComputedStyle(element);
    const preserveContainerWhitespace = ['pre', 'pre-wrap', 'pre-line', 'break-spaces'].includes(containerStyle.whiteSpace);

    walk(element);

    // Trim and adjust ranges ONLY if whitespace is not preserved
    if (!preserveContainerWhitespace) {
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
    const style = getSafeComputedStyle(element);
    const bgColor = parseColor(style.backgroundColor);
    const color = parseColor(style.color);

    // Clean up font family: take first one, remove quotes
    // Clean up font family: analyze stack for monospace
    let fontFamily = style.fontFamily;
    const isMonospace = /\b(monospace|mono|consolas|courier|inconsolata|menlo|monaco|source code pro)\b/i.test(fontFamily);

    // Figma fallback for code blocks
    if (isMonospace) {
        fontFamily = 'Roboto Mono';
    } else {
        // Take first one, remove quotes
        fontFamily = fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    }

    return {
        backgroundColor: bgColor,
        color: color,
        fontSize: parseFloat(style.fontSize) || 16,
        fontWeight: normalizeFontWeight(style.fontWeight),
        fontStyle: style.fontStyle,
        fontFamily: fontFamily,
        textAlign: style.textAlign,
        lineHeight: (style.lineHeight === 'normal') ? (parseFloat(style.fontSize) * 1.2) : (parseFloat(style.lineHeight) || undefined),
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
        marginTop: parseFloat(style.marginTop) || 0,
        marginRight: parseFloat(style.marginRight) || 0,
        marginBottom: parseFloat(style.marginBottom) || 0,
        marginLeft: parseFloat(style.marginLeft) || 0,
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
        columnGap: parseFloat(style.columnGap) || 0,
        rowGap: parseFloat(style.rowGap) || 0,
        position: style.position,
        top: style.top,
        right: style.right,
        bottom: style.bottom,
        left: style.left,
        zIndex: style.zIndex,
        float: style.float,
        borderCollapse: style.borderCollapse,
        borderSpacing: style.borderSpacing // Returns "Xpx Ypx" or "Xpx"
    };
}

/**
 * Traverses DOM and returns Figma-compatible JSON
 * @param {Node} node
 * @param {number} depth
 * @param {Set<Node>} skipNodes Nodes to skip during traversal (already captured in other groups)
 * @param {number} parentYAdjustment Y offset adjustment from parent fixed bottom positioning
 */
function captureNode(node, depth = 0, skipNodes = new Set(), parentYAdjustment = 0, documentOffset = { x: 0, y: 0 }) {
    if (depth > 50) return null;
    if (skipNodes.has(node)) return null;

    if (node.nodeType === Node.TEXT_NODE) {
        const textContent = collapseWhitespace(node.textContent, true);
        if (!textContent) return null;

        const parent = node.parentElement;
        if (!parent) return null;

        const parentStyle = getSafeComputedStyle(parent);
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

        const win = node.ownerDocument.defaultView || window;
        return {
            name: 'Text',
            type: 'TEXT',
            x: left + win.scrollX + documentOffset.x,
            y: top + win.scrollY + documentOffset.y,
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
            textDecoration: getEffectiveTextDecoration(parent),
            fills: [{ type: 'SOLID', color: { r: styles.color.r, g: styles.color.g, b: styles.color.b }, opacity: styles.color.a }],
            // Store style props for sorting
            _zIndex: 'auto',
            _position: 'static',
            _float: 'none'
        };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    // Define win for element nodes
    const win = node.ownerDocument.defaultView || window;

    if (IGNORED_TAGS.includes(node.tagName)) return null;

    // Filter hidden/assistive elements (MathJax, KaTeX)
    if (node.classList && (
        node.classList.contains('mjx-assistive-mml') ||
        node.classList.contains('katex-html') ||
        node.getAttribute('aria-hidden') === 'true'
    )) {
        // Double check if it's truly hidden (sometimes aria-hidden is used for decorative interactions but visuals are there)
        // For MathJax assistive MML, it is definitely hidden clip-path
        if (node.classList.contains('mjx-assistive-mml')) return null;

        // Check for clip rect 1px
        const style = win.getComputedStyle(node);
        if (style.clip === 'rect(1px, 1px, 1px, 1px)' || style.clipPath?.includes('polygon')) {
            return null;
        }
    }

    const style = getSafeComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return null;

    const rect = node.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1 && node.tagName !== 'BODY') return null;

    let finalWidth = rect.width;
    let finalHeight = rect.height;
    let xCorrection = 0;
    let yCorrection = 0;

    // Use offset dimensions ONLY if there's a significant mismatch (indicating rotation)
    // Otherwise rely on getBoundingClientRect for sub-pixel precision (fixes text wrapping)
    if (node instanceof HTMLElement) {
        const widthDiff = Math.abs(rect.width - node.offsetWidth);
        const heightDiff = Math.abs(rect.height - node.offsetHeight);

        // Threshold of 2px to ignore sub-pixel rounding differences but catch geometric transforms
        if (widthDiff > 2 || heightDiff > 2) {
            finalWidth = node.offsetWidth;
            finalHeight = node.offsetHeight;
            // Correction to align the center of the un-rotated box with the center of the bounding, rotated box
            xCorrection = (rect.width - finalWidth) / 2;
            yCorrection = (rect.height - finalHeight) / 2;
        }
    }

    const styles = getStyles(node);

    let absX = rect.left + win.scrollX + documentOffset.x;
    let absY = rect.top + win.scrollY + documentOffset.y;

    // --- MATH CAPTURE ---
    // Check if this is a math container and extract source if available
    const mathContent = getMathContent(node);
    if (mathContent) {
        // Create a single text layer for the math formula
        return {
            name: 'Math (LaTeX)',
            type: 'TEXT',
            x: absX + xCorrection,
            y: absY + yCorrection,
            width: finalWidth,
            height: finalHeight,
            characters: mathContent,
            fontSize: styles.fontSize,
            fontFamily: 'Roboto Mono', // Force monospace for code/math source
            fontWeight: 'regular',
            textAlignHorizontal: 'LEFT',
            textAlignVertical: 'CENTER',
            lineHeight: styles.lineHeight,
            fills: [{ type: 'SOLID', color: { r: styles.color.r, g: styles.color.g, b: styles.color.b }, opacity: styles.color.a }],
            _zIndex: styles.zIndex,
            _position: styles.position,
            _float: styles.float
        };
    }
    // --------------------

    const type = node.tagName === 'IMG' ? 'IMAGE' : (node.tagName === 'svg' || node.tagName === 'SVG' ? 'SVG' : 'FRAME');



    // Track Y adjustment for this element to pass to children
    let currentYAdjustment = parentYAdjustment;

    // Handle fixed positioning
    if (styles.position === 'fixed') {
        // Fixed elements with explicit top should stay at the top (use viewport position)
        if (styles.top !== 'auto' && styles.top !== '') {
            // Use viewport position, not scrolled position
            const topValue = parseFloat(styles.top) || 0;
            absY = rect.top + documentOffset.y; // Use viewport position + doc offset
            // Calculate adjustment needed for children: they should also use viewport coords
            // Children will initially calculate as rect.top + scrollY, so we need to subtract scrollY
            currentYAdjustment = -win.scrollY;
        }
        // Fixed elements with bottom positioning should be at the page bottom
        else if (styles.bottom !== 'auto' && styles.bottom !== '') {
            const bottomValue = parseFloat(styles.bottom) || 0;
            const pageHeight = document.documentElement.scrollHeight;
            const originalY = absY;
            // Position from the bottom of the page (use finalHeight for layout accuracy)
            absY = pageHeight - finalHeight - bottomValue;
            // Calculate the adjustment made
            currentYAdjustment = absY - originalY;
        }
    } else if (parentYAdjustment !== 0) {
        // Apply parent's Y adjustment to non-fixed elements
        absY += parentYAdjustment;
    }

    const layer = {
        name: (node.id ? `#${node.id}` : '') || node.tagName,
        type: type,
        x: absX + xCorrection,
        y: absY + yCorrection,
        width: finalWidth,
        height: finalHeight,
        cornerRadius: styles.borderRadius,
        topLeftRadius: styles.topLeftRadius,
        topRightRadius: styles.topRightRadius,
        bottomLeftRadius: styles.bottomLeftRadius,
        bottomRightRadius: styles.bottomRightRadius,
        opacity: styles.opacity,
        clipsContent: styles.overflow !== 'visible',
        fills: [],
        effects: [],
        children: [],
        // Store style props for sorting
        _zIndex: styles.zIndex,
        _position: styles.position,
        _float: styles.float
    };

    // Capture Table Spacing for AutoLayout
    if (styles.display === 'table') {
        layer.isTable = true;
        // Parse border-spacing "horizontal vertical"
        const parts = styles.borderSpacing.split(' ').map(p => parseFloat(p) || 0);
        const hSpacing = parts[0];
        const vSpacing = parts[1] !== undefined ? parts[1] : hSpacing;

        // If collapsed, spacing is 0
        if (styles.borderCollapse === 'collapse') {
            layer.tableRowGap = 0;
            layer.tableColGap = 0;
        } else {
            layer.tableRowGap = vSpacing;
            layer.tableColGap = hSpacing;
        }
    }

    // For table rows, we need to know the horizontal spacing from the parent table
    if (styles.display === 'table-row') {
        layer.isTableRow = true;
        // Look up parent table to get column gap
        const parentTable = node.closest('table');
        if (parentTable) {
            const tableStyle = getSafeComputedStyle(parentTable);
            if (tableStyle.borderCollapse === 'collapse') {
                layer.tableColGap = 0;
            } else {
                const parts = tableStyle.borderSpacing.split(' ').map(p => parseFloat(p) || 0);
                layer.tableColGap = parts[0];
            }
        }
    }

    // Capture Table Groups (tbody, thead, tfoot)
    if (['table-row-group', 'table-header-group', 'table-footer-group'].includes(styles.display)) {
        layer.isTableGroup = true;
        const parentTable = node.closest('table');
        if (parentTable) {
            const tableStyle = getSafeComputedStyle(parentTable);
            if (tableStyle.borderCollapse === 'collapse') {
                layer.tableRowGap = 0;
            } else {
                const parts = tableStyle.borderSpacing.split(' ').map(p => parseFloat(p) || 0);
                const hSpacing = parts[0];
                const vSpacing = parts[1] !== undefined ? parts[1] : hSpacing;
                layer.tableRowGap = vSpacing;
            }
        }
    }

    // RICH TEXT SUPPORT: If this is a text container, capture its contents as a single layer
    if (isTextContainer(node) && (node.childNodes.length > 0)) {
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
                x: absX + xCorrection, // Use corrected position
                y: absY + yCorrection,
                width: finalWidth,     // Use un-rotated size
                height: finalHeight,
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

    if (node.tagName === 'IFRAME') {
        try {
            const doc = node.contentDocument;
            if (doc && doc.body) {
                const childWin = doc.defaultView || window;
                const bLeft = styles.borderLeftWidth || 0;
                const bTop = styles.borderTopWidth || 0;

                const newDocOffset = {
                    x: absX + bLeft - childWin.scrollX,
                    y: absY + bTop - childWin.scrollY
                };

                const bodyLayer = captureNode(doc.body, depth + 1, skipNodes, 0, newDocOffset);
                if (bodyLayer) {
                    layer.children.push(bodyLayer);
                }
            }
        } catch (e) { }
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
        top: styles.borderTopColor.a > 0 ? styles.borderTopWidth : 0,
        right: styles.borderRightColor.a > 0 ? styles.borderRightWidth : 0,
        bottom: styles.borderBottomColor.a > 0 ? styles.borderBottomWidth : 0,
        left: styles.borderLeftColor.a > 0 ? styles.borderLeftWidth : 0
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

    // Special handling for form elements: INPUT, TEXTAREA, SELECT
    // These elements don't have text nodes for their values, so we create a virtual text layer
    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
        // Special handling for COLOR inputs
        if (node.tagName === 'INPUT' && node.type === 'color') {
            const colorVal = node.value; // e.g. #ff0000
            const parsedColor = parseColor(colorVal);

            layer.children.push({
                name: 'Color Value',
                type: 'RECTANGLE',
                x: absX + xCorrection + styles.paddingLeft,
                y: absY + yCorrection + styles.paddingTop,
                width: finalWidth - styles.paddingLeft - styles.paddingRight,
                height: finalHeight - styles.paddingTop - styles.paddingBottom,
                cornerRadius: 2, // Slight radius for the swatch
                fills: [{ type: 'SOLID', color: { r: parsedColor.r, g: parsedColor.g, b: parsedColor.b }, opacity: parsedColor.a }]
            });
        } else {
            let valueText = "";
            let isPlaceholder = false;

            if (node.tagName === 'SELECT') {
                const selectedOption = node.options[node.selectedIndex];
                valueText = selectedOption ? selectedOption.text : "";
            } else {
                valueText = node.value || "";
                // If no value, check for placeholder
                if (!valueText && node.placeholder) {
                    valueText = node.placeholder;
                    isPlaceholder = true;
                }
            }

            if (valueText) {
                let textAlignHorizontal = styles.textAlign.toUpperCase();
                if (textAlignHorizontal === 'START') textAlignHorizontal = 'LEFT';
                if (textAlignHorizontal === 'END') textAlignHorizontal = 'RIGHT';
                if (textAlignHorizontal === 'JUSTIFY') textAlignHorizontal = 'JUSTIFIED';
                if (!['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'].includes(textAlignHorizontal)) textAlignHorizontal = 'LEFT';

                // Use reduced opacity for placeholder text
                const textOpacity = isPlaceholder ? 0.5 : styles.color.a;

                layer.children.push({
                    name: isPlaceholder ? 'Placeholder' : 'Value',
                    type: 'TEXT',
                    x: absX + xCorrection + styles.paddingLeft,
                    y: absY + yCorrection + styles.paddingTop,
                    width: finalWidth - styles.paddingLeft - styles.paddingRight,
                    height: finalHeight - styles.paddingTop - styles.paddingBottom,
                    characters: valueText,
                    fontSize: styles.fontSize,
                    fontFamily: styles.fontFamily,
                    fontWeight: styles.fontWeight,
                    textAlignHorizontal: textAlignHorizontal,
                    textAlignVertical: 'CENTER', // Generally vertically centered in standard inputs
                    lineHeight: styles.lineHeight,
                    fills: [{ type: 'SOLID', color: { r: styles.color.r, g: styles.color.g, b: styles.color.b }, opacity: textOpacity }]
                });
            }
        }
    }

    let childCount = 0;
    for (const child of node.childNodes) {
        if (childCount > 500) break;
        const childLayer = captureNode(child, depth + 1, skipNodes, currentYAdjustment, documentOffset);
        if (childLayer) {
            layer.children.push(childLayer);
            childCount++;
        }
    }

    // Sort children based on CSS stacking context rules
    // 1. Backgrounds and borders (handled by parent container in Figma)
    // 2. Negative z-index children
    // 3. Block-level, non-positioned children
    // 4. Floated, non-positioned children
    // 5. Inline, non-positioned children (text nodes handled here)
    // 6. Positioned children (z-index: auto or 0)
    // 7. Positive z-index children

    layer.children.sort((a, b) => {
        const getWeight = (childLayer) => {
            // Text nodes are effectively inline-level content
            if (childLayer.type === 'TEXT') return 5;

            // For other elements, we need their style info. 
            // Since we don't persist the raw style object in the layer, we need to infer or store it.
            // Ideally, we should have stored these properties on the layer object during creation.
            // Let's assume we add them to the layer object in the captureNode function above.

            const zIndexVal = childLayer._zIndex === 'auto' ? 0 : parseInt(childLayer._zIndex || '0');
            const position = childLayer._position || 'static';
            const float = childLayer._float || 'none';
            const isPositioned = position !== 'static';

            if (isPositioned) {
                if (zIndexVal < 0) return 1;
                if (zIndexVal > 0) return 6 + zIndexVal; // Higher z-index = higher weight
                return 6; // Positioned, z-index auto/0
            }

            // Static alignment
            if (float !== 'none') return 4;
            // We can't easily distinguish block vs inline purely from Figma layer props without more data,
            // but generally non-positioned elements come before positioned specific ones in painting order.
            // Let's treat them as standard flow (3). 
            // Note: Inline elements are technically painted later (5), but for basic structure 3 is safer default.
            return 3;
        };

        const weightA = getWeight(a);
        const weightB = getWeight(b);

        if (weightA !== weightB) {
            return weightA - weightB;
        }
        // If weights are equal, maintain DOM order (stable sort)
        return 0;
    });

    // Remove temporary properties used for sorting
    layer.children.forEach(child => {
        delete child._zIndex;
        delete child._position;
        delete child._float;
    });

    return layer;
}

/**
 * Finds all elements with a specific position that don't have an ancestor with that same position
 */
function findRootPositionedElements(rootNode, positions) {
    const roots = [];
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const style = getSafeComputedStyle(node);
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
            const parentStyle = getSafeComputedStyle(parent);
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

