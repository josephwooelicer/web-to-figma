const IGNORED_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'BR', 'VIDEO', 'CANVAS', 'OBJECT', 'EMBED'];

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
        fontWeight: style.fontWeight,
        fontFamily: fontFamily,
        borderRadius: parseFloat(style.borderRadius) || 0,
        opacity: parseFloat(style.opacity) || 1,
        borderWidth: parseFloat(style.borderWidth) || 0,
        borderColor: parseColor(style.borderColor)
    };
}

/**
 * Traverses DOM and returns Figma-compatible JSON
 */
function captureNode(node, depth = 0) {
    if (depth > 50) return null;

    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (!text) return null;

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

        return {
            name: 'Text',
            type: 'TEXT',
            x: left + window.scrollX,
            y: top + window.scrollY,
            width: right - left,
            height: bottom - top,
            characters: node.textContent,
            fontSize: styles.fontSize,
            fontFamily: styles.fontFamily,
            fontWeight: styles.fontWeight,
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

    const layer = {
        name: (node.id ? `#${node.id}` : '') || node.tagName,
        type: type,
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
        cornerRadius: styles.borderRadius,
        opacity: styles.opacity,
        fills: [],
        children: []
    };

    if (type === 'SVG') {
        layer.svgContent = node.outerHTML;
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

    if (styles.borderWidth > 0) {
        layer.strokes = [{
            type: 'SOLID',
            color: { r: styles.borderColor.r, g: styles.borderColor.g, b: styles.borderColor.b },
            opacity: styles.borderColor.a
        }];
        layer.strokeWeight = styles.borderWidth;
    }

    let childCount = 0;
    for (const child of node.childNodes) {
        if (childCount > 500) break;
        const childLayer = captureNode(child, depth + 1);
        if (childLayer) {
            layer.children.push(childLayer);
            childCount++;
        }
    }

    return layer;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CAPTURE') {
        try {
            const root = captureNode(document.body);
            sendResponse({ data: root });
        } catch (e) {
            console.error(e);
            sendResponse({ error: e.message });
        }
    }
    return true;
});
