import { RefObject, useEffect, useRef } from 'react';

type EventListenerTarget =
  | EventTarget
  | null
  | undefined
  | RefObject<EventTarget | null | undefined>;

type UseEventListenerOptions = AddEventListenerOptions & {
  target?: EventListenerTarget;
};

function resolveTarget(target: EventListenerTarget): EventTarget | null {
  if (!target) {
    return typeof window === 'undefined' ? null : window;
  }

  if ('current' in target) {
    return target.current || null;
  }

  return target;
}

export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: UseEventListenerOptions
): void;
export function useEventListener(
  eventName: string,
  handler: (event: Event) => void,
  options?: UseEventListenerOptions
): void;
export function useEventListener(
  eventName: string,
  handler: (event: Event) => void,
  options: UseEventListenerOptions = {}
): void {
  const handlerRef = useRef(handler);
  const { target, capture, passive, once } = options;

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const element = resolveTarget(target);
    if (!element) {
      return;
    }

    const listener = (event: Event) => {
      handlerRef.current(event);
    };
    const listenerOptions = { capture, passive, once };

    element.addEventListener(eventName, listener, listenerOptions);
    return () => {
      element.removeEventListener(eventName, listener, listenerOptions);
    };
  }, [eventName, target, capture, passive, once]);
}
