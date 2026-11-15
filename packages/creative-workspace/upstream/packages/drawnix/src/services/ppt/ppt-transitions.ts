import type { PPTSlideTransition, PPTSlideTransitionType } from './ppt.types';

const PPT_TRANSITION_TYPES = new Set<PPTSlideTransitionType>([
  'none',
  'fade',
  'push',
  'wipe',
  'split',
  'cover',
  'uncover',
]);

export const PPT_DEFAULT_TRANSITION_DURATION_MS = 700;
const PPT_MIN_TRANSITION_DURATION_MS = 150;
const PPT_MAX_TRANSITION_DURATION_MS = 3000;

export interface PPTTransitionOption {
  type: PPTSlideTransitionType;
  label: string;
  description: string;
  durationMs: number;
}

export const PPT_TRANSITION_OPTIONS: PPTTransitionOption[] = [
  {
    type: 'none',
    label: '无',
    description: '立即切换',
    durationMs: 0,
  },
  {
    type: 'fade',
    label: '淡入淡出',
    description: '柔和淡入',
    durationMs: 700,
  },
  {
    type: 'push',
    label: '推入',
    description: '页面横向推入',
    durationMs: 650,
  },
  {
    type: 'wipe',
    label: '擦除',
    description: '从左向右展开',
    durationMs: 650,
  },
  {
    type: 'split',
    label: '分割',
    description: '从中间展开',
    durationMs: 700,
  },
  {
    type: 'cover',
    label: '覆盖',
    description: '新页覆盖当前页',
    durationMs: 650,
  },
  {
    type: 'uncover',
    label: '揭开',
    description: '揭开进入下一页',
    durationMs: 650,
  },
];

function isPPTSlideTransitionType(
  value: unknown
): value is PPTSlideTransitionType {
  return typeof value === 'string' && PPT_TRANSITION_TYPES.has(value as any);
}

function normalizeDurationMs(
  value: unknown,
  fallback: number
): number | undefined {
  if (fallback <= 0) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(
    PPT_MAX_TRANSITION_DURATION_MS,
    Math.max(PPT_MIN_TRANSITION_DURATION_MS, Math.round(value))
  );
}

export function getPPTTransitionOption(
  type: PPTSlideTransitionType
): PPTTransitionOption {
  return (
    PPT_TRANSITION_OPTIONS.find((option) => option.type === type) ||
    PPT_TRANSITION_OPTIONS[0]
  );
}

export function normalizePPTSlideTransition(
  transition?: Partial<PPTSlideTransition> | null
): PPTSlideTransition {
  if (!transition || !isPPTSlideTransitionType(transition.type)) {
    return { type: 'none' };
  }

  if (transition.type === 'none') {
    return { type: 'none' };
  }

  const option = getPPTTransitionOption(transition.type);
  return {
    type: transition.type,
    durationMs: normalizeDurationMs(transition.durationMs, option.durationMs),
  };
}

export function getPPTSlideTransition(
  transition?: Partial<PPTSlideTransition> | null
): PPTSlideTransition {
  return normalizePPTSlideTransition(transition);
}

export function hasPPTSlideTransition(
  transition?: Partial<PPTSlideTransition> | null
): boolean {
  return normalizePPTSlideTransition(transition).type !== 'none';
}

function getPPTTransitionSpeed(durationMs?: number): 'fast' | 'med' | 'slow' {
  const duration = durationMs || PPT_DEFAULT_TRANSITION_DURATION_MS;
  if (duration <= 450) return 'fast';
  if (duration >= 1000) return 'slow';
  return 'med';
}

export function buildPPTSlideTransitionXml(
  transition?: Partial<PPTSlideTransition> | null
): string {
  const normalized = normalizePPTSlideTransition(transition);
  if (normalized.type === 'none') {
    return '';
  }

  const speed = getPPTTransitionSpeed(normalized.durationMs);
  const childByType: Record<Exclude<PPTSlideTransitionType, 'none'>, string> = {
    fade: '<p:fade/>',
    push: '<p:push dir="l"/>',
    wipe: '<p:wipe dir="l"/>',
    split: '<p:split orient="horz" dir="out"/>',
    cover: '<p:cover dir="l"/>',
    uncover: '<p:pull dir="l"/>',
  };

  return `<p:transition spd="${speed}">${
    childByType[normalized.type]
  }</p:transition>`;
}

function removeExistingTransitionXml(slideXml: string): string {
  return slideXml
    .replace(/<p:transition\b[\s\S]*?<\/p:transition>/, '')
    .replace(/<p:transition\b[^/>]*\/>/, '');
}

export function injectPPTSlideTransitionXml(
  slideXml: string,
  transition?: Partial<PPTSlideTransition> | null
): string {
  const transitionXml = buildPPTSlideTransitionXml(transition);
  const withoutTransition = removeExistingTransitionXml(slideXml);
  if (!transitionXml) {
    return withoutTransition;
  }

  const clrMapClose = '</p:clrMapOvr>';
  const cSldClose = '</p:cSld>';
  if (withoutTransition.includes(clrMapClose)) {
    return withoutTransition.replace(
      clrMapClose,
      `${clrMapClose}${transitionXml}`
    );
  }
  if (withoutTransition.includes(cSldClose)) {
    return withoutTransition.replace(cSldClose, `${cSldClose}${transitionXml}`);
  }
  return withoutTransition.replace('</p:sld>', `${transitionXml}</p:sld>`);
}

export function injectPPTSlideTransitions(
  slideXml: string,
  transition?: Partial<PPTSlideTransition> | null
): string;
export function injectPPTSlideTransitions(
  pptxBlob: Blob,
  transitions: Array<Partial<PPTSlideTransition> | null | undefined>
): Promise<Blob>;
export function injectPPTSlideTransitions(
  input: string | Blob,
  transitionOrTransitions?:
    | Partial<PPTSlideTransition>
    | null
    | Array<Partial<PPTSlideTransition> | null | undefined>
): string | Promise<Blob> {
  if (typeof input === 'string') {
    return injectPPTSlideTransitionXml(
      input,
      Array.isArray(transitionOrTransitions)
        ? undefined
        : transitionOrTransitions
    );
  }

  const transitions = Array.isArray(transitionOrTransitions)
    ? transitionOrTransitions
    : [];
  return injectPPTXSlideTransitions(input, transitions);
}

async function injectPPTXSlideTransitions(
  pptxBlob: Blob,
  transitions: Array<Partial<PPTSlideTransition> | null | undefined>
): Promise<Blob> {
  if (!transitions.some(hasPPTSlideTransition)) {
    return pptxBlob;
  }

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(pptxBlob);
  await Promise.all(
    transitions.map(async (transition, index) => {
      if (!hasPPTSlideTransition(transition)) {
        return;
      }

      const slidePath = `ppt/slides/slide${index + 1}.xml`;
      const slideFile = zip.file(slidePath);
      if (!slideFile) {
        return;
      }

      const slideXml = await slideFile.async('string');
      zip.file(slidePath, injectPPTSlideTransitionXml(slideXml, transition));
    })
  );

  return zip.generateAsync({
    type: 'blob',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
