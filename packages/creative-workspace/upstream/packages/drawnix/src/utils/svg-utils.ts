export interface SvgDimensions {
  width: number;
  height: number;
}

const DEFAULT_SVG_DIMENSIONS: SvgDimensions = {
  width: 400,
  height: 400,
};

export function normalizeSvg(svg: string): string {
  let normalized = svg.trim();
  if (!normalized.includes('xmlns=')) {
    normalized = normalized.replace(
      '<svg',
      '<svg xmlns="http://www.w3.org/2000/svg"'
    );
  }
  return normalized;
}

export function parseSvgDimensions(svg: string): SvgDimensions {
  const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number);
    if (parts.length >= 4 && parts[2] && parts[3]) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const widthMatch = svg.match(/width=["'](\d+)(?:px)?["']/i);
  const heightMatch = svg.match(/height=["'](\d+)(?:px)?["']/i);
  if (widthMatch && heightMatch) {
    return {
      width: parseInt(widthMatch[1]),
      height: parseInt(heightMatch[1]),
    };
  }

  return DEFAULT_SVG_DIMENSIONS;
}

export function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}
