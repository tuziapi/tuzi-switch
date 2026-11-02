const SVG_NS = 'http://www.w3.org/2000/svg';

/** WebKit can decode an HTML image but fail to paint it inside foreignObject. */
export function mountNativeImageOverlay(
  foreignObject: SVGForeignObjectElement,
  source: string,
  options: { contain?: boolean; hidden?: boolean; opacity?: number } = {}
): () => void {
  const parent = foreignObject.parentElement;
  if (!parent) return () => undefined;

  const image = document.createElementNS(SVG_NS, 'image');
  image.setAttribute('data-native-image-overlay', 'true');
  image.setAttribute('pointer-events', 'none');
  image.setAttribute('href', source);
  image.setAttribute(
    'preserveAspectRatio',
    options.contain ? 'xMidYMid meet' : 'none'
  );
  if (options.hidden) image.setAttribute('visibility', 'hidden');
  if (options.opacity !== undefined) {
    image.setAttribute('opacity', String(options.opacity));
  }

  const syncRectangle = () => {
    for (const attribute of ['x', 'y', 'width', 'height']) {
      image.setAttribute(
        attribute,
        foreignObject.getAttribute(attribute) || '0'
      );
    }
  };
  syncRectangle();
  parent.insertBefore(image, foreignObject.nextSibling);
  const observer = new MutationObserver(syncRectangle);
  observer.observe(foreignObject, {
    attributes: true,
    attributeFilter: ['x', 'y', 'width', 'height'],
  });
  const previousVisibility = foreignObject.style.visibility;
  foreignObject.style.visibility = 'hidden';

  return () => {
    observer.disconnect();
    image.remove();
    foreignObject.style.visibility = previousVisibility;
  };
}
